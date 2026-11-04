package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.SettingCard
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface SettingCardRepository : JpaRepository<SettingCard, UUID> {
}
