package ai.storyfork.content.proposal.entity

import jakarta.persistence.*

@Entity
@Table(name="change_proposal_receipt")
class ChangeProposalReceiptEntity(
    @field:Id @field:Column(name="id") val id: String = "",
    @field:Column(name="proposal_id") val proposalId: String = "",
    @field:Column(name="proposal_version") val proposalVersion: Int = 1,
    @field:Column(name="work_id") val workId: String = "",
    @field:Column(name="actor_id") val actorId: String = "",
    @field:Column(name="decision") val decision: String = "",
    @field:Column(name="key_hash") val keyHash: String = "",
    @field:Column(name="request_hash") val requestHash: String = "",
    @field:Column(name="receipt_json") val receiptJson: String = "",
)
