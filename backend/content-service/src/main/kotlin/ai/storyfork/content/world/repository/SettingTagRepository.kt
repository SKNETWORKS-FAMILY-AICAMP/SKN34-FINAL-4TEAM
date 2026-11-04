package ai.storyfork.content.world.repository

import ai.storyfork.content.world.entity.SettingTagEntity
import org.springframework.data.jpa.repository.*

interface SettingTagRepository : JpaRepository<SettingTagEntity, String> {

}
