package ai.storyfork.content.world.entity

import jakarta.persistence.*
import java.time.Instant
import org.hibernate.annotations.Immutable

@Entity
@Table(name = "setting_version")
@Immutable
class SettingVersionEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "setting_document_id")
    var settingDocumentId: String = "",
    @field:Column(name = "content_version_id")
    var contentVersionId: String = "",
    @field:Column(name = "revision_no")
    var revisionNo: Int = 0,
    @field:Column(name = "name")
    var name: String = "",
    @field:Column(name = "category_id")
    var categoryId: String = "",
    @field:Column(name = "content")
    var content: String = "",
    @field:Column(name = "evidence")
    var evidence: String = "",
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
    @field:Column(name = "restored_from_id")
    var restoredFromId: String? = null,
    @field:Column(name = "lifecycle")
    var lifecycle: String = "active",
    @field:Column(name = "visibility_history_id")
    var visibilityHistoryId: String? = null,
)
