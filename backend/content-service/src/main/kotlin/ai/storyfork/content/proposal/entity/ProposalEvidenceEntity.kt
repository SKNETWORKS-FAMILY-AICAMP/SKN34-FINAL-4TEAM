package ai.storyfork.content.proposal.entity

import jakarta.persistence.*

@Entity
@Table(name = "proposal_evidence")
@IdClass(ProposalEvidenceEntity.Key::class)
class ProposalEvidenceEntity(
    @field:Id @field:Column(name = "proposal_id")
    var proposalId: String = "",
    @field:Id @field:Column(name = "evidence_id")
    var evidenceId: String = "",
) {
    data class Key(var proposalId: String = "", var evidenceId: String = "") : java.io.Serializable
}
