package ai.storyfork.content.world.repository

import ai.storyfork.content.world.entity.SettingDraftEntity
import org.springframework.data.jpa.repository.*

interface SettingDraftRepository : JpaRepository<SettingDraftEntity, String> {
    fun findAllBySettingDocumentIdInOrderByEditOrder(settingDocumentIds: Collection<String>): List<SettingDraftEntity>
}
