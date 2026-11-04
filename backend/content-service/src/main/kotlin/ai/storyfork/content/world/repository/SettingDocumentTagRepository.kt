package ai.storyfork.content.world.repository

import ai.storyfork.content.world.entity.SettingDocumentTagEntity
import org.springframework.data.jpa.repository.*

interface SettingDocumentTagRepository : JpaRepository<SettingDocumentTagEntity, SettingDocumentTagEntity.Key> {
    fun findAllBySettingDocumentId(settingDocumentId: String): List<SettingDocumentTagEntity>
}
