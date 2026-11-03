package ai.storyfork.core.world.repository

import ai.storyfork.core.world.entity.SettingKnowledgeScopeEntity
import org.springframework.data.jpa.repository.*

interface SettingKnowledgeScopeRepository : JpaRepository<SettingKnowledgeScopeEntity, SettingKnowledgeScopeEntity.Key> {
    fun findAllBySettingVersionIdInOrderByPositionAscCharacterNameAsc(settingVersionIds: Collection<String>): List<SettingKnowledgeScopeEntity>
}
