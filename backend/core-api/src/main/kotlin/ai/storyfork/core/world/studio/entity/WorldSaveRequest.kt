package ai.storyfork.core.world.studio.entity

import jakarta.persistence.*
import java.util.UUID
import java.time.Instant
import org.hibernate.annotations.Immutable

@Entity
@Table(name="world_save_request", schema="worldstudio")
@Immutable
class WorldSaveRequest(
    @EmbeddedId val id: WorldSaveKey,
    @Column(name="request_hash", columnDefinition="text", nullable=false) val requestHash: String,
    @Column(name="revision_id", nullable=false) val revisionId: UUID,
    @Column(name="created_at", nullable=false) val createdAt: Instant = Instant.now()
)
