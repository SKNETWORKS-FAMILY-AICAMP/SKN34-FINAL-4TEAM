package ai.storyfork.core.world.entity

import jakarta.persistence.*
import java.util.UUID
import java.time.Instant

@Entity
@Table(name="relationship_draft", schema="worldstudio")
class RelationshipDraft(
    @Id @Column(name="relation_id") val relationId: UUID,
    @Column(name="world_id", nullable=false) val worldId: UUID,
    @Embedded var fields: RelationshipFields = RelationshipFields(),
    @Column(name="updated_at", nullable=false) var updatedAt: Instant = Instant.now()
)
