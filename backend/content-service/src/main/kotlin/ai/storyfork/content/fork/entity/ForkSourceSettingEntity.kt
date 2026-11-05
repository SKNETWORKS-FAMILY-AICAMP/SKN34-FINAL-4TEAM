package ai.storyfork.content.fork.entity

import jakarta.persistence.*

@Entity
@Table(name = "fork_source_setting")
@IdClass(ForkSourceSettingEntity.Key::class)
class ForkSourceSettingEntity(
    @field:Id @field:Column(name = "fork_work_id")
    var forkWorkId: String = "",
    @field:Id @field:Column(name = "setting_document_id")
    var settingDocumentId: String = "",
    @field:Column(name = "setting_version_id")
    var settingVersionId: String = "",
) {
    data class Key(var forkWorkId: String = "", var settingDocumentId: String = "") : java.io.Serializable
}
