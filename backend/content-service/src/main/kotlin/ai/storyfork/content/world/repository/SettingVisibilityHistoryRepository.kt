package ai.storyfork.content.world.repository

import ai.storyfork.content.world.entity.SettingVisibilityHistoryEntity
import org.springframework.data.jpa.repository.*

interface SettingVisibilityHistoryRepository : JpaRepository<SettingVisibilityHistoryEntity, String> {

}
