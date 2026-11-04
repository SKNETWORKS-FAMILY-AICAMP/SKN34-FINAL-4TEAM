package ai.storyfork.content.world.repository

import ai.storyfork.content.world.entity.SettingVersionTagEntity
import org.springframework.data.jpa.repository.*

interface SettingVersionTagRepository : JpaRepository<SettingVersionTagEntity, SettingVersionTagEntity.Key> {
    fun findAllBySettingVersionIdInOrderByPosition(settingVersionIds: Collection<String>): List<SettingVersionTagEntity>
}
