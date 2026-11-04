package ai.storyfork.core.world.repository

import ai.storyfork.core.world.entity.SettingCard
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface SettingCardRepository : JpaRepository<SettingCard, UUID> {
}
