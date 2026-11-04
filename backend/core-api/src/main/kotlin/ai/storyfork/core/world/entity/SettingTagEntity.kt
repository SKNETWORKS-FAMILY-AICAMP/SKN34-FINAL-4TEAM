package ai.storyfork.core.world.entity

import jakarta.persistence.*

@Entity
@Table(name = "setting_tag")
class SettingTagEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "owner_id")
    var ownerId: String = "",
    @field:Column(name = "name")
    var name: String = "",
)
