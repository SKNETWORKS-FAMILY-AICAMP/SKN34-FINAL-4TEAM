package ai.storyfork.core.world.studio.entity

import jakarta.persistence.*
import java.util.UUID
import java.time.Instant

@Entity
@Table(name="world_revision", schema="worldstudio")
class WorldRevision(
    @Id val id: UUID = UUID.randomUUID(),
    @Column(name="world_id", nullable=false) val worldId: UUID,
    @Column(name="revision_no", nullable=false) val revisionNo: Long,
    @Column(columnDefinition="text", nullable=false) val name: String,
    @Column(columnDefinition="text", nullable=false) val description: String,
    @Column(name="parent_revision_id") val parentRevisionId: UUID? = null,
    @Column(name="restored_from_revision_id") val restoredFromRevisionId: UUID? = null,
    @Column(nullable=false) var sealed: Boolean = false,
    @Column(name="created_at", nullable=false) val createdAt: Instant = Instant.now()
)
