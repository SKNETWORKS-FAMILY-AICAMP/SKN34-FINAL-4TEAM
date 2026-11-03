package ai.storyfork.core.world.repository

import ai.storyfork.core.world.entity.SettingDraftEntity
import org.springframework.data.jpa.repository.*

interface SettingDraftRepository : JpaRepository<SettingDraftEntity, String> {
    fun findAllBySettingDocumentIdInOrderByEditOrder(settingDocumentIds: Collection<String>): List<SettingDraftEntity>
}
