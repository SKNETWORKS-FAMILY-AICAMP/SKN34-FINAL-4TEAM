package ai.storyfork.core.world.repository

import ai.storyfork.core.world.entity.SettingTagEntity
import org.springframework.data.jpa.repository.*

interface SettingTagRepository : JpaRepository<SettingTagEntity, String> {

}
