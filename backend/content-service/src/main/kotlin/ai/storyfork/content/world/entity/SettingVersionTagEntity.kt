package ai.storyfork.content.world.entity

import jakarta.persistence.*

@Entity
@Table(name = "setting_version_tag")
@IdClass(SettingVersionTagEntity.Key::class)
class SettingVersionTagEntity(
    @field:Id @field:Column(name = "setting_version_id")
    var settingVersionId: String = "",
    @field:Id @field:Column(name = "setting_tag_id")
    var settingTagId: String = "",
    @field:Column(name = "position")
    var position: Int = 0,
) {
    data class Key(var settingVersionId: String = "", var settingTagId: String = "") : java.io.Serializable
}
