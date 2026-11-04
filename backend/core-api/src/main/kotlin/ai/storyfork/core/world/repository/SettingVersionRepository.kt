package ai.storyfork.core.world.repository

import ai.storyfork.core.world.entity.SettingVersionEntity
import org.springframework.data.jpa.repository.*

interface SettingVersionRepository : JpaRepository<SettingVersionEntity, String> {
    fun findAllBySettingDocumentIdInOrderByRevisionNo(settingDocumentIds: Collection<String>): List<SettingVersionEntity>
}
