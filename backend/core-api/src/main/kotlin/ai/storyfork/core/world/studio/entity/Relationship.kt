package ai.storyfork.core.world.studio.entity

import jakarta.persistence.*
import java.util.UUID
import java.time.Instant

@Entity
@Table(name="relationship", schema="worldstudio")
class Relationship(
    @Id val id: UUID = UUID.randomUUID(),
    @Column(name="world_id", nullable=false) val worldId: UUID,
    @Column(name="created_at", nullable=false) val createdAt: Instant = Instant.now()
)
