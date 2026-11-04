package ai.storyfork.content.proposal.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "ai_proposal")
class AiProposalEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "job_id")
    var jobId: String = "",
    @field:Column(name = "kind")
    var kind: String = "",
    @field:Column(name = "content")
    var content: String = "",
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
    @field:Column(name = "input_snapshot_id")
    var inputSnapshotId: String? = null,
    @field:Column(name = "sequence")
    var sequence: Int = 0,
)
