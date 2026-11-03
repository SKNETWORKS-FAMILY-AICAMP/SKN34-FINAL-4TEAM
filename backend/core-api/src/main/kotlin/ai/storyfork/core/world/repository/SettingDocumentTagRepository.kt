package ai.storyfork.core.world.repository

import ai.storyfork.core.world.entity.SettingDocumentTagEntity
import org.springframework.data.jpa.repository.*

interface SettingDocumentTagRepository : JpaRepository<SettingDocumentTagEntity, SettingDocumentTagEntity.Key> {
    fun findAllBySettingDocumentId(settingDocumentId: String): List<SettingDocumentTagEntity>
}
