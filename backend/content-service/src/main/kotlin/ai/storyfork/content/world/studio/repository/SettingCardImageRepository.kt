package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.SettingCardImage
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface SettingCardImageRepository : JpaRepository<SettingCardImage, UUID>
