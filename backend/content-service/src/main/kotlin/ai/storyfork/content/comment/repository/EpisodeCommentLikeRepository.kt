package ai.storyfork.content.comment.repository

import ai.storyfork.content.comment.entity.EpisodeCommentLikeEntity
import org.springframework.data.jpa.repository.*

interface EpisodeCommentLikeRepository : JpaRepository<EpisodeCommentLikeEntity, EpisodeCommentLikeEntity.Key> {
    /** 주어진 댓글들의 좋아요 행이다. 개수와 보는 회원의 좋아요 여부를 서비스가 메모리에서 계산한다. */
    fun findAllByCommentIdIn(commentIds: Collection<String>): List<EpisodeCommentLikeEntity>
}
