package ai.storyfork.content.feedbackreport.entity

import jakarta.persistence.*
import java.time.Instant
import java.time.temporal.ChronoUnit

/** 제보자의 정정(`correct`, 본문 있음)과 철회(`withdraw`, 본문 없음) 기록이다. 원래 제보는 바꾸지 않고 기록만 더한다. */
@Entity
@Table(name = "feedback_report_amendment")
class FeedbackReportAmendmentEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "report_id")
    var reportId: String = "",
    @field:Column(name = "action")
    var action: String = "",
    @field:Column(name = "body")
    var body: String? = null,
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
)
