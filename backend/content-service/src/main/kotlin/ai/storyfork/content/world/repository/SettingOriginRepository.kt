package ai.storyfork.content.world.repository

import ai.storyfork.content.world.entity.SettingOriginEntity
import org.springframework.data.jpa.repository.*

interface SettingOriginRepository : JpaRepository<SettingOriginEntity, String> {

}
