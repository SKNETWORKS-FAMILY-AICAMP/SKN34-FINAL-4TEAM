package ai.storyfork.core.world.repository

import ai.storyfork.core.world.entity.SettingVisibilityHistoryEntity
import org.springframework.data.jpa.repository.*

interface SettingVisibilityHistoryRepository : JpaRepository<SettingVisibilityHistoryEntity, String> {

}
