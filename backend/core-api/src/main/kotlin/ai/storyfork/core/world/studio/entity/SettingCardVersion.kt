package ai.storyfork.core.world.studio.entity

import jakarta.persistence.*
import java.util.UUID
import java.time.Instant
import org.hibernate.annotations.Immutable

@Entity
@Table(name="setting_card_version", schema="worldstudio")
@Immutable
class SettingCardVersion(
    @Id val id: UUID = UUID.randomUUID(),
    @Column(name="card_id", nullable=false) val cardId: UUID,
    @Column(name="world_id", nullable=false) val worldId: UUID,
    @Column(name="version_no", nullable=false) val versionNo: Long,
    @Embedded val fields: CardFields,
    @Column(name="restored_from_version_id") val restoredFromVersionId: UUID? = null,
    @Column(name="created_at", nullable=false) val createdAt: Instant = Instant.now()
)
