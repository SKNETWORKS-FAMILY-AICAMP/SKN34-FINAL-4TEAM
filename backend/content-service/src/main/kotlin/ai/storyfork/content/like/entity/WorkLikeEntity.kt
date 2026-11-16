package ai.storyfork.content.like.entity

import jakarta.persistence.*
import java.time.Instant

/** 회원이 공개 작품에 남긴 좋아요 한 건. 작품당 회원 1회이며 수는 요청 때 센다. */
@Entity
@Table(name = "work_like")
@IdClass(WorkLikeEntity.Key::class)
class WorkLikeEntity(
    @field:Id @field:Column(name = "work_id")
    var workId: String = "",
    @field:Id @field:Column(name = "member_id")
    var memberId: String = "",
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
) {
    data class Key(var workId: String = "", var memberId: String = "") : java.io.Serializable
}
