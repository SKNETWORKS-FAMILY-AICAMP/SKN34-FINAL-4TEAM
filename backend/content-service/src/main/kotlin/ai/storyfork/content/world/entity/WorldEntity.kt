package ai.storyfork.content.world.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "world")
class WorldEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "owner_id")
    var ownerId: String = "",
    @field:Column(name = "name")
    var name: String = "",
    @field:Column(name = "description")
    var description: String = "",
    @field:Column(name = "revision")
    var revision: Int = 0,
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
)
