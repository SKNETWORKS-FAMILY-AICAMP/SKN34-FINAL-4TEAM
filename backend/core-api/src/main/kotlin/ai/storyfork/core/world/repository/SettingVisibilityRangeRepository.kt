package ai.storyfork.core.world.repository

import ai.storyfork.core.world.entity.SettingVisibilityRangeEntity
import org.springframework.data.jpa.repository.*

interface SettingVisibilityRangeRepository : JpaRepository<SettingVisibilityRangeEntity, String> {
    fun findAllByVisibilityHistoryIdIn(visibilityHistoryIds: Collection<String>): List<SettingVisibilityRangeEntity>
}
