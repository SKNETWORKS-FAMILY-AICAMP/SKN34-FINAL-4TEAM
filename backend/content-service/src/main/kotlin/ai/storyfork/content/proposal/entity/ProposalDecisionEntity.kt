package ai.storyfork.content.proposal.entity

import jakarta.persistence.*
import java.time.Instant
import org.hibernate.annotations.Immutable

@Entity
@Table(name = "proposal_decision")
@Immutable
class ProposalDecisionEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "proposal_id")
    var proposalId: String = "",
    @field:Column(name = "sequence")
    var sequence: Int = 0,
    @field:Column(name = "actor_id")
    var actorId: String? = null,
    @field:Column(name = "decision")
    var decision: String = "",
    @field:Column(name = "selected_range")
    var selectedRange: String? = null,
    @field:Column(name = "approved_content")
    var approvedContent: String = "",
    @field:Column(name = "decided_at")
    var decidedAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
)
