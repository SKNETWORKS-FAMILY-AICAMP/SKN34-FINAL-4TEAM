package ai.storyfork.content.episode_version.entity

import jakarta.persistence.*

@Entity
@Table(name = "checkpoint_setting")
@IdClass(CheckpointSettingEntity.Key::class)
class CheckpointSettingEntity(
    @field:Id @field:Column(name = "checkpoint_id")
    var checkpointId: String = "",
    @field:Id @field:Column(name = "setting_document_id")
    var settingDocumentId: String = "",
    @field:Column(name = "setting_version_id")
    var settingVersionId: String = "",
) {
    data class Key(var checkpointId: String = "", var settingDocumentId: String = "") : java.io.Serializable
}
