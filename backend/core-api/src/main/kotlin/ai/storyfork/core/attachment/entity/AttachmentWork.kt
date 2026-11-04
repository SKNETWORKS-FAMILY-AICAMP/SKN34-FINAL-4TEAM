package ai.storyfork.core.attachment.entity

import jakarta.persistence.*
import org.hibernate.annotations.Immutable

/** 기존 현재 작품 VIEW를 권한 조회에만 사용한다. */
@Entity
@Immutable
@Table(name = "work_current")
open class AttachmentWork(
    @Id @Column(length = 36) open var id: String = "",
    @Column(name = "owner_id", length = 200) open var ownerId: String = "",
    @Column(name = "world_id", length = 36) open var worldId: String = "",
)
