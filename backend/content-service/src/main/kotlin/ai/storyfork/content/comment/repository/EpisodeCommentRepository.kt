package ai.storyfork.content.comment.repository

import ai.storyfork.content.comment.entity.EpisodeCommentEntity
import org.springframework.data.jpa.repository.*

interface EpisodeCommentRepository : JpaRepository<EpisodeCommentEntity, String> {
    /** 삭제되지 않은 회차 댓글을 작성 최신순으로 최대 200개 돌려준다. */
    fun findTop200ByWorkIdAndEpisodeNumberAndDeletedAtIsNullOrderByCreatedAtDesc(workId: String, episodeNumber: Int): List<EpisodeCommentEntity>

    /** 삭제되지 않은 댓글 하나다. 작품이나 회차가 다르면 없는 것으로 본다. */
    fun findByIdAndWorkIdAndEpisodeNumberAndDeletedAtIsNull(id: String, workId: String, episodeNumber: Int): EpisodeCommentEntity?
}
