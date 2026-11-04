package ai.storyfork.content.world.studio.entity

import jakarta.persistence.*
import java.util.UUID

@Embeddable
data class WorldSaveKey(
    @Column(name="world_id") var worldId: UUID = UUID(0,0),
    @Column(name="request_key", columnDefinition="text") var requestKey: String = "",
) : java.io.Serializable
