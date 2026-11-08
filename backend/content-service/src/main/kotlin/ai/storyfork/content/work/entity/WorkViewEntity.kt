package ai.storyfork.content.work.entity

import jakarta.persistence.*
import java.time.Instant
import java.time.LocalDate

/** 회원·회차별 하루(Asia/Seoul 날짜) 1회 조회 기록. 실시간 랭킹과 조회 수 정렬의 정본이다. */
@Entity
@Table(name = "work_view")
@IdClass(WorkViewEntity.Key::class)
class WorkViewEntity(
    @field:Id @field:Column(name = "work_id")
    var workId: String = "",
    @field:Id @field:Column(name = "episode_number")
    var episodeNumber: Int = 0,
    @field:Id @field:Column(name = "member_id")
    var memberId: String = "",
    @field:Id @field:Column(name = "view_date")
    var viewDate: LocalDate = LocalDate.EPOCH,
    @field:Column(name = "viewed_at")
    var viewedAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
) {
    data class Key(var workId: String = "", var episodeNumber: Int = 0, var memberId: String = "", var viewDate: LocalDate = LocalDate.EPOCH) : java.io.Serializable
}
