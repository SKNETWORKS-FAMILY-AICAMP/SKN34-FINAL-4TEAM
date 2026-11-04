package ai.storyfork.content.proposal.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "proposal_application")
class ProposalApplicationEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "decision_id")
    var decisionId: String = "",
    @field:Column(name = "attempt_no")
    var attemptNo: Int = 0,
    @field:Column(name = "outcome")
    var outcome: String = "",
    @field:Column(name = "failure_reason")
    var failureReason: String? = null,
    @field:Column(name = "attempted_at")
    var attemptedAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
)
