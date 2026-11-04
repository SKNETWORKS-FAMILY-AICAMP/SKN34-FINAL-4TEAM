package ai.storyfork.content.fork.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "fork_source_change")
class ForkSourceChangeEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "fork_work_id")
    var forkWorkId: String = "",
    @field:Column(name = "source_change_ref")
    var sourceChangeRef: String = "",
    @field:Column(name = "before_checkpoint_id")
    var beforeCheckpointId: String? = null,
    @field:Column(name = "after_checkpoint_id")
    var afterCheckpointId: String? = null,
    @field:Column(name = "detected_at")
    var detectedAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
)
