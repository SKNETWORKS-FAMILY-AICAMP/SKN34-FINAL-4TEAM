package ai.storyfork.core.world.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "setting_origin")
class SettingOriginEntity(
    @field:Id @field:Column(name = "setting_document_id")
    var settingDocumentId: String = "",
    @field:Column(name = "source_setting_version_id")
    var sourceSettingVersionId: String = "",
    @field:Column(name = "copied_at")
    var copiedAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
)
