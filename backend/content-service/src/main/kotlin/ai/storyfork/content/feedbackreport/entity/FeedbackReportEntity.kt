package ai.storyfork.content.feedbackreport.entity

import jakarta.persistence.*
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * 독자가 공개 작품의 발행 회차에 남긴 제보다. 등록 시점의 발행 버전 ID를 고정 저장하고 행은 지우지 않는다(DEC-42).
 * 원문(body·quote)은 바뀌지 않으며 정정·철회는 [FeedbackReportAmendmentEntity]에 쌓고, 철회는 [withdrawnAt]로만 표시한다.
 * 제보자·작가 표시명은 저장하지 않는다. 응답 때마다 Core 닉네임을 조회한다.
 */
@Entity
@Table(name = "feedback_report")
class FeedbackReportEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "work_id")
    var workId: String = "",
    @field:Column(name = "episode_number")
    var episodeNumber: Int = 0,
    @field:Column(name = "published_version_id")
    var publishedVersionId: String = "",
    @field:Column(name = "reporter_id")
    var reporterId: String = "",
    @field:Column(name = "kind")
    var kind: String = "",
    @field:Column(name = "body")
    var body: String = "",
    @field:Column(name = "quote")
    var quote: String? = null,
    @field:Column(name = "visibility")
    var visibility: String = "private",
    @field:Column(name = "status")
    var status: String = "unchecked",
    @field:Column(name = "author_checked_at")
    var authorCheckedAt: Instant? = null,
    @field:Column(name = "withdrawn_at")
    var withdrawnAt: Instant? = null,
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
    @field:Column(name = "updated_at")
    var updatedAt: Instant = createdAt,
)
