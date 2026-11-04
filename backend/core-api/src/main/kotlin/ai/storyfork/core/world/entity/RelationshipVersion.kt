package ai.storyfork.core.world.entity

import jakarta.persistence.*
import java.util.UUID
import java.time.Instant
import org.hibernate.annotations.Immutable

@Entity
@Table(name="relationship_version", schema="worldstudio")
@Immutable
class RelationshipVersion(
    @Id val id: UUID = UUID.randomUUID(),
    @Column(name="relation_id", nullable=false) val relationId: UUID,
    @Column(name="world_id", nullable=false) val worldId: UUID,
    @Column(name="version_no", nullable=false) val versionNo: Long,
    @Embedded val fields: RelationshipFields,
    @Column(name="restored_from_version_id") val restoredFromVersionId: UUID? = null,
    @Column(name="created_at", nullable=false) val createdAt: Instant = Instant.now()
)
