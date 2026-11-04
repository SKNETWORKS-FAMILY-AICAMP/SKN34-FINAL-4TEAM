package ai.storyfork.core.world.entity

import jakarta.persistence.*
import java.util.UUID
import org.hibernate.annotations.Immutable

@Entity
@Table(name="world_revision_card", schema="worldstudio")
@Immutable
class WorldRevisionCard(
    @EmbeddedId val id: RevisionCardKey,
    @Column(name="world_id", nullable=false) val worldId: UUID,
    @Column(name="version_id", nullable=false) val versionId: UUID
)
