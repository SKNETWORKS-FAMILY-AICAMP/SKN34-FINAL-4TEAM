package ai.storyfork.content.fork.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "fork_world_reference")
class ForkWorldReferenceEntity(
    @field:Id @field:Column(name = "fork_work_id")
    var forkWorkId: String = "",
    @field:Column(name = "source_world_id")
    var sourceWorldId: String? = null,
    @field:Column(name = "reference_status")
    var referenceStatus: String = "",
    @field:Column(name = "last_followed_checkpoint_id")
    var lastFollowedCheckpointId: String? = null,
    @field:Column(name = "detached_at")
    var detachedAt: Instant? = null,
)
