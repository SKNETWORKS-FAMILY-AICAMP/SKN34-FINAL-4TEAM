package ai.storyfork.core.world.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "setting_document")
class SettingDocumentEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "world_id")
    var worldId: String = "",
    @field:Column(name = "logical_id")
    var logicalId: String = "",
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
)
