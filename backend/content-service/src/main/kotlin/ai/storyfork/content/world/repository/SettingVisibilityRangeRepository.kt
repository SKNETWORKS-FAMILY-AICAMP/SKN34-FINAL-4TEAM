package ai.storyfork.content.world.repository

import ai.storyfork.content.world.entity.SettingVisibilityRangeEntity
import org.springframework.data.jpa.repository.*

interface SettingVisibilityRangeRepository : JpaRepository<SettingVisibilityRangeEntity, String> {
    fun findAllByVisibilityHistoryIdIn(visibilityHistoryIds: Collection<String>): List<SettingVisibilityRangeEntity>
}
