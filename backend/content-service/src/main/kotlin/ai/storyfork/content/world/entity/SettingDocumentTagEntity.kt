package ai.storyfork.content.world.entity

import jakarta.persistence.*

@Entity
@Table(name = "setting_document_tag")
@IdClass(SettingDocumentTagEntity.Key::class)
class SettingDocumentTagEntity(
    @field:Id @field:Column(name = "setting_document_id")
    var settingDocumentId: String = "",
    @field:Id @field:Column(name = "setting_tag_id")
    var settingTagId: String = "",
) {
    data class Key(var settingDocumentId: String = "", var settingTagId: String = "") : java.io.Serializable
}
