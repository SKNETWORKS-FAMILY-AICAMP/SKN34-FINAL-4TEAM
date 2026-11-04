package ai.storyfork.content.world.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "setting_visibility_history")
class SettingVisibilityHistoryEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "setting_document_id")
    var settingDocumentId: String = "",
    @field:Column(name = "revision_no")
    var revisionNo: Int = 0,
    @field:Column(name = "default_visibility")
    var defaultVisibility: String = "",
    @field:Column(name = "changed_at")
    var changedAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
)
