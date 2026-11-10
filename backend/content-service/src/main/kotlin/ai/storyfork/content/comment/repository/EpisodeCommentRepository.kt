package ai.storyfork.content.comment.repository

import ai.storyfork.content.comment.entity.EpisodeCommentEntity
import org.springframework.data.jpa.repository.*

interface EpisodeCommentRepository : JpaRepository<EpisodeCommentEntity, String> {
    /** 삭제되지 않은 회차 댓글을 작성 최신순으로 최대 200개 돌려준다. */
    fun findTop200ByWorkIdAndEpisodeNumberAndDeletedAtIsNullOrderByCreatedAtDesc(workId: String, episodeNumber: Int): List<EpisodeCommentEntity>

    /** 삭제되지 않은 댓글 하나다. 작품이나 회차가 다르면 없는 것으로 본다. */
    fun findByIdAndWorkIdAndEpisodeNumberAndDeletedAtIsNull(id: String, workId: String, episodeNumber: Int): EpisodeCommentEntity?

    /** 운영 댓글 목록용 `[댓글, 작품 제목]` 행이다. 삭제되지 않은 댓글 중 삭제되지 않은 작품의 것만 작성 최신순(같은 시각은 id순)으로 쿼리 한 번에 읽는다. */
    @Query("""select c, w.title from EpisodeCommentEntity c join WorkEntity w on w.id = c.workId
        where c.deletedAt is null and w.deletedAt is null order by c.createdAt desc, c.id""")
    fun listForOperations(): List<Array<Any?>>
}
