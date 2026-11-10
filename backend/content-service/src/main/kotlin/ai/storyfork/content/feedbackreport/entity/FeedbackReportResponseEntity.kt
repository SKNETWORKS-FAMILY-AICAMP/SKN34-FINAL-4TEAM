package ai.storyfork.content.feedbackreport.entity

import jakarta.persistence.*
import java.time.Instant
import java.time.temporal.ChronoUnit

/** 작품 소유자의 제보 답변이다. 공개 답변([isPublic])만 제보자·소유자 밖의 사람에게 보인다. 작가 표시명은 저장하지 않는다. */
@Entity
@Table(name = "feedback_report_response")
class FeedbackReportResponseEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "report_id")
    var reportId: String = "",
    @field:Column(name = "author_id")
    var authorId: String = "",
    @field:Column(name = "body")
    var body: String = "",
    @field:Column(name = "is_public")
    var isPublic: Boolean = false,
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
)
