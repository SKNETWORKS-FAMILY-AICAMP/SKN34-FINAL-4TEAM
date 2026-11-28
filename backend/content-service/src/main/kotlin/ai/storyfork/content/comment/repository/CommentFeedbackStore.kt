package ai.storyfork.content.comment.repository

import ai.storyfork.content.comment.client.dto.FeedbackPrediction
import ai.storyfork.content.comment.service.dto.CommentFeedbackResult
import java.util.UUID
import javax.sql.DataSource
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Repository

data class ClaimedFeedback(val id: String, val body: String, val token: UUID)

@Repository
class CommentFeedbackStore(@Qualifier("contentDataSource") source: DataSource) {
    private val db = JdbcTemplate(source)

    /** 잠금은 이 단일 문장에서 끝난다. HTTP 호출 중 DB 잠금을 잡지 않는다. */
    fun claim(seconds: Long): ClaimedFeedback? = claimBatch(seconds, 1).singleOrNull()

    fun claimBatch(seconds: Long, limit: Int): List<ClaimedFeedback> {
        require(limit in 1..32)
        val token = UUID.randomUUID()
        return db.query("""
            WITH pick AS (
                SELECT f.comment_id,c.body FROM episode_comment_feedback f JOIN episode_comment c ON c.id=f.comment_id
                WHERE f.status IN ('PENDING','RUNNING') AND f.due_at <= now() AND c.deleted_at IS NULL AND NOT c.hidden
                AND f.body_sha256 = encode(sha256(convert_to(c.body,'UTF8')),'hex')
                ORDER BY f.due_at,f.comment_id LIMIT ? FOR UPDATE OF f SKIP LOCKED
            )
            UPDATE episode_comment_feedback f SET status='RUNNING',claim_id=?,attempts=attempts+1,
                due_at=now()+ (? * interval '1 second'),failure=NULL FROM pick WHERE f.comment_id=pick.comment_id
            RETURNING f.comment_id,pick.body
        """.trimIndent(), { rs, _ -> ClaimedFeedback(rs.getString(1), rs.getString(2), token) }, limit, token, seconds)
    }

    fun complete(job: ClaimedFeedback, result: FeedbackPrediction) =
        db.update("""UPDATE episode_comment_feedback SET status='COMPLETED',feedback=?,probability=?,
            model_version=?,threshold=?,primary_aspect=?,aspect_version=?,claim_id=NULL WHERE comment_id=? AND claim_id=?""",
            result.isFeedback,result.feedbackProbability,result.modelVersion,result.threshold,result.primaryAspect,result.aspectVersion,job.id,job.token)

    fun fail(job: ClaimedFeedback, reason: String, retry: Boolean) =
        db.update("""UPDATE episode_comment_feedback SET status=CASE WHEN ? AND attempts<3 THEN 'PENDING' ELSE 'FAILED' END,
            due_at=now()+interval '30 seconds',failure=?,claim_id=NULL WHERE comment_id=? AND claim_id=?""",
            retry,reason,job.id,job.token)

    data class Entry(val id: String, val episodeNumber: Int, val body: String)
    data class Inbox(val total: Long, val items: List<Entry>)

    fun inbox(work: String, episode: Int?, offset: Int, size: Int): Inbox {
        val filter = """FROM episode_comment_feedback f JOIN episode_comment c ON c.id=f.comment_id
            WHERE c.work_id=? AND c.deleted_at IS NULL AND NOT c.hidden
            AND f.status='COMPLETED' AND f.feedback""" + if (episode == null) "" else " AND c.episode_number=?"
        val args = listOfNotNull<Any>(work, episode).toTypedArray()
        val total = db.queryForObject("SELECT count(*) $filter", Long::class.java, *args)!!
        val items = if (size == 0) emptyList() else db.query(
            "SELECT c.id,c.episode_number,c.body $filter ORDER BY c.created_at DESC,c.id DESC LIMIT ? OFFSET ?",
            { rs, _ -> Entry(rs.getString(1), rs.getInt(2), rs.getString(3)) }, *args, size, offset)
        return Inbox(total, items)
    }

    fun read(work: String, episode: Int, id: String): CommentFeedbackResult? =
        db.query("""SELECT f.* FROM episode_comment_feedback f JOIN episode_comment c ON c.id=f.comment_id
            WHERE c.work_id=? AND c.episode_number=? AND c.id=? AND c.deleted_at IS NULL AND NOT c.hidden""",
            { rs, _ -> CommentFeedbackResult(id,rs.getLong("revision"),rs.getString("status"),
                rs.getObject("feedback") as Boolean?,rs.getObject("probability") as Double?,
                rs.getString("model_version"),rs.getObject("threshold") as Double?,rs.getString("failure"),rs.getString("primary_aspect"),rs.getString("aspect_version")) },
            work,episode,id).singleOrNull()

    data class AspectCount(val modelVersion: String, val threshold: Double, val aspectVersion: String?,
                           val primaryAspect: String?, val isFeedback: Boolean, val count: Long)

    fun counts(work: String, episode: Int?): List<AspectCount> {
        val filter = if (episode == null) "" else " AND c.episode_number=?"
        return db.query("""SELECT model_version,threshold,aspect_version,primary_aspect,feedback,count(*)
            FROM episode_comment_feedback f JOIN episode_comment c ON c.id=f.comment_id
            WHERE c.work_id=? AND NOT c.hidden AND c.deleted_at IS NULL AND f.status='COMPLETED' $filter
            GROUP BY model_version,threshold,aspect_version,primary_aspect,feedback
            ORDER BY model_version,threshold,aspect_version,primary_aspect,feedback""",
            { rs,_ -> AspectCount(rs.getString(1),rs.getDouble(2),rs.getString(3),rs.getString(4),rs.getBoolean(5),rs.getLong(6)) },
            *listOfNotNull<Any>(work,episode).toTypedArray())
    }

    fun retryFailed(work: String, episode: Int, id: String): Boolean =
        db.update("""UPDATE episode_comment_feedback f SET status='PENDING', attempts=0,due_at=now(),failure=NULL
            FROM episode_comment c WHERE c.id=f.comment_id AND c.work_id=? AND c.episode_number=? AND c.id=?
            AND NOT c.hidden AND c.deleted_at IS NULL AND f.status='FAILED'""",work,episode,id) == 1
}
