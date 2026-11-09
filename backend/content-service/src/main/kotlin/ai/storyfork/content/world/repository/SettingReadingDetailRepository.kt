package ai.storyfork.content.world.repository

import ai.storyfork.content.world.entity.SettingReadingDetailEntity
import org.springframework.data.jpa.repository.JpaRepository

interface SettingReadingDetailRepository : JpaRepository<SettingReadingDetailEntity, String>
