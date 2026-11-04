package ai.storyfork.content.world.entity

import jakarta.persistence.*
import java.time.Instant
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes

@Entity
@Table(name = "setting_draft")
class SettingDraftEntity(
    @field:Id @field:Column(name = "setting_document_id")
    var settingDocumentId: String = "",
    @field:Column(name = "name")
    var name: String = "",
    @field:Column(name = "category_id")
    var categoryId: String = "",
    @field:Column(name = "content")
    var content: String = "",
    @field:Column(name = "from_episode")
    var fromEpisode: Int = 0,
    @field:Column(name = "to_episode")
    var toEpisode: Int? = null,
    @field:Column(name = "visibility_status")
    var visibilityStatus: String = "",
    @field:Column(name = "known_by", columnDefinition = "text[]")
    @field:JdbcTypeCode(SqlTypes.ARRAY)
    var knownBy: List<String> = emptyList(),
    @field:Column(name = "tags", columnDefinition = "text[]")
    @field:JdbcTypeCode(SqlTypes.ARRAY)
    var tags: List<String> = emptyList(),
    @field:Column(name = "evidence")
    var evidence: String = "",
    @field:Column(name = "edit_order")
    var editOrder: Int = 0,
    @field:Column(name = "updated_at")
    var updatedAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
    @field:Column(name = "edit_revision")
    var editRevision: Int = 0,
)
