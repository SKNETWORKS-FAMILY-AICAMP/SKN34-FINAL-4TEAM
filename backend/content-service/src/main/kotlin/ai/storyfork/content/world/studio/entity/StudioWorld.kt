package ai.storyfork.content.world.studio.entity

import jakarta.persistence.*
import java.util.UUID
import java.time.Instant

@Entity
@Table(name="world", schema="worldstudio")
class StudioWorld(
    @Id var id: UUID = UUID.randomUUID(),
    @Column(name="owner_subject", nullable=false) val ownerSubject: UUID,
    @Column(name="current_revision_id") var currentRevisionId: UUID? = null,
    @Column(name="created_at", nullable=false) val createdAt: Instant = Instant.now()
)
