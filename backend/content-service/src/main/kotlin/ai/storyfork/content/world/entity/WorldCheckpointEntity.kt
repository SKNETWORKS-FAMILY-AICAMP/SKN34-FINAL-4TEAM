package ai.storyfork.content.world.entity

import jakarta.persistence.*
import java.time.Instant
import org.hibernate.annotations.Immutable

@Entity
@Immutable
@Table(name = "world_checkpoint")
class WorldCheckpointEntity(
    @field:Id val id: String = "",
    @field:Column(name = "work_id") val workId: String = "",
    @field:Column(name = "created_at") val createdAt: Instant = Instant.EPOCH,
    val snapshot: String = "",
)
