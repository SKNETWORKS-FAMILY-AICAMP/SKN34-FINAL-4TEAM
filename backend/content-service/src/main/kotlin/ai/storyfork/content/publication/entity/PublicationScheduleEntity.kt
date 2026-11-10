package ai.storyfork.content.publication.entity

import ai.storyfork.content._common.exception.checkContent
import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "publication_schedule")
class PublicationScheduleEntity(
    @field:Id var id: String = "",
    @field:Column(name = "work_id") var workId: String = "",
    @field:Column(name = "episode_id") var episodeId: String = "",
    @field:Column(name = "owner_id") var ownerId: String = "",
    @field:Column(name = "version_id") var versionId: String = "",
    @field:Column(name = "scheduled_at") var scheduledAt: Instant = Instant.EPOCH,
    var status: String = "pending",
    var revision: Int = 0,
    @field:Column(name = "completed_at") var completedAt: Instant? = null,
    @field:Column(name = "failure_reason") var failureReason: String? = null,
) {
    fun requireEditable(expected: Int) {
        checkContent(status == "pending" && revision == expected, 409, "예약이 변경되었거나 이미 처리됐어요. 다시 조회해 주세요.")
    }

    fun isDue(now: Instant) = status == "pending" && scheduledAt <= now

    fun reschedule(expected: Int, version: String, at: Instant) {
        requireEditable(expected)
        versionId = version
        scheduledAt = at
        revision++
    }

    fun cancel(expected: Int, now: Instant) {
        requireEditable(expected)
        status = "canceled"
        completedAt = now
        revision++
    }

    fun complete(now: Instant, reason: String? = null) {
        checkContent(isDue(now), 409, "실행할 대기 예약이 아니에요.")
        status = if (reason == null) "published" else "failed"
        completedAt = now
        failureReason = reason
        revision++
    }
}
