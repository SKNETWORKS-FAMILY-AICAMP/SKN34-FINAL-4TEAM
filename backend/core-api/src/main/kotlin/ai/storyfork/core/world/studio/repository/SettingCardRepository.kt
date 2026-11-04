package ai.storyfork.core.world.studio.repository

import ai.storyfork.core.world.studio.entity.SettingCard
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface SettingCardRepository : JpaRepository<SettingCard, UUID> {
}
