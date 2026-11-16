package ai.storyfork.content.comment.repository

import ai.storyfork.content.comment.entity.EpisodeCommentLikeEntity
import org.springframework.data.jpa.repository.*

interface EpisodeCommentLikeRepository : JpaRepository<EpisodeCommentLikeEntity, EpisodeCommentLikeEntity.Key> {
    /** 주어진 댓글들의 좋아요 행이다. 개수와 보는 회원의 좋아요 여부를 서비스가 메모리에서 계산한다. */
    fun findAllByCommentIdIn(commentIds: Collection<String>): List<EpisodeCommentLikeEntity>

    /**
     * 운영 댓글 목록용 `[댓글 id, 공감 수]` 행이다. 쿼리 한 번이며 공감이 없는 댓글은 행이 없다.
     * ponytail: 전체 좋아요를 한 번에 센다. 운영 목록에 페이지네이션을 넣으면 대상 댓글 id로 좁힌다.
     */
    @Query("select l.commentId, count(l.memberId) from EpisodeCommentLikeEntity l group by l.commentId")
    fun countAllByComment(): List<Array<Any?>>
}
