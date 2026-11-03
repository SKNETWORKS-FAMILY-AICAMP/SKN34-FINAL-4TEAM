package ai.storyfork.core.world.repository

import ai.storyfork.core.world.entity.SettingVersionTagEntity
import org.springframework.data.jpa.repository.*

interface SettingVersionTagRepository : JpaRepository<SettingVersionTagEntity, SettingVersionTagEntity.Key> {
    fun findAllBySettingVersionIdInOrderByPosition(settingVersionIds: Collection<String>): List<SettingVersionTagEntity>
}
