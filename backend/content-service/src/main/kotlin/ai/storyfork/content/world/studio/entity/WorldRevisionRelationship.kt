package ai.storyfork.content.world.studio.entity

import jakarta.persistence.*
import java.util.UUID
import org.hibernate.annotations.Immutable

@Entity
@Table(name="world_revision_relationship", schema="worldstudio")
@Immutable
class WorldRevisionRelationship(
    @EmbeddedId val id: RevisionRelationshipKey,
    @Column(name="world_id", nullable=false) val worldId: UUID,
    @Column(name="version_id", nullable=false) val versionId: UUID
)
