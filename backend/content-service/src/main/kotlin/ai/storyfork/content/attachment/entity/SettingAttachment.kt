package ai.storyfork.content.attachment.entity

import jakarta.persistence.*
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "setting_attachment")
open class SettingAttachment(
    @Id @Column(length = 36) open var id: String = UUID.randomUUID().toString(),
    @Column(name = "setting_document_id", nullable = false, length = 36) open var settingDocumentId: String = "",
    @Column(name = "object_key", nullable = false, length = 200) open var objectKey: String = "",
    @Column(name = "filename", nullable = false, length = 120) open var filename: String = "",
    @Column(name = "media_type", nullable = false, length = 100) open var mediaType: String = "",
    @Column(nullable = false, length = 10) open var kind: String = "",
    @Column(name = "byte_size", nullable = false) open var byteSize: Long = 0,
    @Column(name = "created_at", nullable = false) open var createdAt: Instant = Instant.now(),
)
