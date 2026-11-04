package ai.storyfork.content.world.studio.entity

import jakarta.persistence.*
import java.util.UUID
import java.time.Instant

@Entity
@Table(name="setting_card_draft", schema="worldstudio")
class SettingCardDraft(
    @Id @Column(name="card_id") val cardId: UUID,
    @Column(name="world_id", nullable=false) val worldId: UUID,
    @Embedded var fields: CardFields = CardFields(),
    @Column(name="updated_at", nullable=false) var updatedAt: Instant = Instant.now()
)
