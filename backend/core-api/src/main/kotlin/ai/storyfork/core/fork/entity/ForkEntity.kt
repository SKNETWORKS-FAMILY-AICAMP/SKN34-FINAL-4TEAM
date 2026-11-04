package ai.storyfork.core.fork.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "fork")
class ForkEntity(
    @field:Id @field:Column(name = "work_id")
    var workId: String = "",
    @field:Column(name = "source_work_id")
    var sourceWorkId: String = "",
    @field:Column(name = "owner_id")
    var ownerId: String = "",
    @field:Column(name = "source_checkpoint_id")
    var sourceCheckpointId: String = "",
    @field:Column(name = "confirmed_policy_history_id")
    var confirmedPolicyHistoryId: String? = null,
    @field:Column(name = "conditions_confirmed_at")
    var conditionsConfirmedAt: Instant? = null,
    @field:Column(name = "source_title")
    var sourceTitle: String = "",
    @field:Column(name = "direction")
    var direction: String = "",
    @field:Column(name = "world_revision")
    var worldRevision: Int = 0,
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
)
