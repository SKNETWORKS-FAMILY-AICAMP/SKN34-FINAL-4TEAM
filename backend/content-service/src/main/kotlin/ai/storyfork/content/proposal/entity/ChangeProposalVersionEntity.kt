package ai.storyfork.content.proposal.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name="change_proposal_version")
class ChangeProposalVersionEntity(
    @field:Id @field:Column(name="id") val id: String = "",
    @field:Column(name="proposal_id") val proposalId: String = "",
    @field:Column(name="proposal_version") val proposalVersion: Int = 1,
    @field:Column(name="work_id") val workId: String = "",
    @field:Column(name="run_id") val runId: String = "",
    @field:Column(name="manifest_json") val manifestJson: String = "",
    @field:Column(name="proposal_hash") val proposalHash: String = "",
    @field:Column(name="key_hash") val keyHash: String = "",
    @field:Column(name="request_hash") val requestHash: String = "",
    @field:Column(name="created_at") val createdAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
)
