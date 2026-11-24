package ai.storyfork.content.attachment.entity

import jakarta.persistence.*
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "setting_attachment")
open class SettingAttachment(
    @Id @Column(length = 36) open var id: String = UUID.randomUUID().toString(),
    /** 첨부가 붙는 곳은 옛 설정 문서([settingDocumentId]) 또는 세계관 카드([worldCardId]) 중 하나다(#735, DB CHECK). 카드는 다른 스키마라 FK 없이 서비스가 확인한다. */
    @Column(name = "setting_document_id", length = 36) open var settingDocumentId: String? = null,
    @Column(name = "world_card_id", length = 36) open var worldCardId: String? = null,
    @Column(name = "object_key", nullable = false, length = 200) open var objectKey: String = "",
    @Column(name = "filename", nullable = false, length = 120) open var filename: String = "",
    @Column(name = "media_type", nullable = false, length = 100) open var mediaType: String = "",
    @Column(nullable = false, length = 10) open var kind: String = "",
    @Column(name = "byte_size", nullable = false) open var byteSize: Long = 0,
    @Column(name = "created_at", nullable = false) open var createdAt: Instant = Instant.now(),
)
