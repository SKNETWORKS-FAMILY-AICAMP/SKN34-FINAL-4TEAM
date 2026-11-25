package ai.storyfork.content.attachment.repository

import ai.storyfork.content.attachment.entity.SettingAttachment
import org.springframework.data.jpa.repository.JpaRepository

interface SettingAttachmentRepository : JpaRepository<SettingAttachment, String> {
    fun findAllBySettingDocumentIdOrderByCreatedAtAscIdAsc(settingDocumentId: String): List<SettingAttachment>
    fun findByIdAndSettingDocumentId(id: String, settingDocumentId: String): SettingAttachment?
    fun countBySettingDocumentIdAndKind(settingDocumentId: String, kind: String): Long
    fun findAllByWorldCardIdOrderByCreatedAtAscIdAsc(worldCardId: String): List<SettingAttachment>
    fun findByIdAndWorldCardId(id: String, worldCardId: String): SettingAttachment?
    fun countByWorldCardIdAndKind(worldCardId: String, kind: String): Long
}
