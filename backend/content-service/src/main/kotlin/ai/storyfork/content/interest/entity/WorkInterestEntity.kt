package ai.storyfork.content.interest.entity

import jakarta.persistence.*
import java.time.Instant

/** 회원이 작품을 관심 작품에 담은 기록. 회원·작품당 한 행이며 목록은 본인만 본다. */
@Entity
@Table(name = "work_interest")
@IdClass(WorkInterestEntity.Key::class)
class WorkInterestEntity(
    @field:Id @field:Column(name = "work_id")
    var workId: String = "",
    @field:Id @field:Column(name = "member_id")
    var memberId: String = "",
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
) {
    data class Key(var workId: String = "", var memberId: String = "") : java.io.Serializable
}
