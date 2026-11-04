package ai.storyfork.core.world.studio.entity

import jakarta.persistence.*
import java.util.UUID
import java.time.Instant

@Entity
@Table(name="world_draft", schema="worldstudio")
class WorldDraft(
    @Id @Column(name="world_id") val worldId: UUID,
    @Column(columnDefinition="text", nullable=false) var name: String = "",
    @Column(columnDefinition="text", nullable=false) var description: String = "",
    @Column(name="draft_revision", nullable=false) var draftRevision: Long = 0,
    @Column(name="base_world_revision_id") var baseWorldRevisionId: UUID? = null,
    @Column(name="updated_at", nullable=false) var updatedAt: Instant = Instant.now()
)
