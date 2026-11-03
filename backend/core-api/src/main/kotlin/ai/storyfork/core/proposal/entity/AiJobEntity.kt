package ai.storyfork.core.proposal.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "ai_job")
class AiJobEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "requester_id")
    var requesterId: String = "",
    @field:Column(name = "work_id")
    var workId: String = "",
    @field:Column(name = "kind")
    var kind: String = "",
    @field:Column(name = "status")
    var status: String = "",
    @field:Column(name = "failure_reason")
    var failureReason: String? = null,
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
    @field:Column(name = "finished_at")
    var finishedAt: Instant? = null,
    @field:Column(name = "request_text")
    var requestText: String = "",
    @field:Column(name = "started_at")
    var startedAt: Instant? = null,
)
