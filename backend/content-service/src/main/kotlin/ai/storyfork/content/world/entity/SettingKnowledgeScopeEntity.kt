package ai.storyfork.content.world.entity

import jakarta.persistence.*

@Entity
@Table(name = "setting_knowledge_scope")
@IdClass(SettingKnowledgeScopeEntity.Key::class)
class SettingKnowledgeScopeEntity(
    @field:Id @field:Column(name = "setting_version_id")
    var settingVersionId: String = "",
    @field:Id @field:Column(name = "character_name")
    var characterName: String = "",
    @field:Column(name = "position")
    var position: Int = 0,
) {
    data class Key(var settingVersionId: String = "", var characterName: String = "") : java.io.Serializable
}
