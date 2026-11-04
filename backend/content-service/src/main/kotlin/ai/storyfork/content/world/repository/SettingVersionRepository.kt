package ai.storyfork.content.world.repository

import ai.storyfork.content.world.entity.SettingVersionEntity
import org.springframework.data.jpa.repository.*

interface SettingVersionRepository : JpaRepository<SettingVersionEntity, String> {
    fun findAllBySettingDocumentIdInOrderByRevisionNo(settingDocumentIds: Collection<String>): List<SettingVersionEntity>
}
