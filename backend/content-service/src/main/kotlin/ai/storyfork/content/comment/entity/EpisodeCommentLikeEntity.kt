package ai.storyfork.content.comment.entity

import jakarta.persistence.*
import java.time.Instant
import java.time.temporal.ChronoUnit

/** 회원의 댓글 좋아요 한 건이다. 취소는 이 행의 하드 삭제이며 같은 회원은 댓글마다 한 번만 누를 수 있다. */
@Entity
@Table(name = "episode_comment_like")
@IdClass(EpisodeCommentLikeEntity.Key::class)
class EpisodeCommentLikeEntity(
    @field:Id @field:Column(name = "comment_id")
    var commentId: String = "",
    @field:Id @field:Column(name = "member_id")
    var memberId: String = "",
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
) {
    data class Key(var commentId: String = "", var memberId: String = "") : java.io.Serializable
}
