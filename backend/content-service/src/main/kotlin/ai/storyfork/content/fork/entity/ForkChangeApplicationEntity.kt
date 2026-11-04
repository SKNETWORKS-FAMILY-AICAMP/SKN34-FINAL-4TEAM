package ai.storyfork.content.fork.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "fork_change_application")
class ForkChangeApplicationEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "decision_id")
    var decisionId: String = "",
    @field:Column(name = "result_checkpoint_id")
    var resultCheckpointId: String? = null,
    @field:Column(name = "outcome")
    var outcome: String = "",
    @field:Column(name = "reason")
    var reason: String? = null,
    @field:Column(name = "applied_at")
    var appliedAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
)
