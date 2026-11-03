package ai.storyfork.core.settingattachment.entity

import jakarta.persistence.*

/** 기존 설정 문서의 식별자만 매핑한다. 설정 내용·공개 정책을 변경하지 않는다. */
@Entity
@Table(name = "setting_document")
open class AttachmentSetting(
    @Id @Column(length = 36) open var id: String = "",
    @Column(name = "world_id", length = 36) open var worldId: String = "",
    @Column(name = "logical_id", length = 36) open var logicalId: String = "",
)
