package ai.storyfork.core.world.repository

import ai.storyfork.core.world.entity.SettingOriginEntity
import org.springframework.data.jpa.repository.*

interface SettingOriginRepository : JpaRepository<SettingOriginEntity, String> {

}
