package ai.storyfork.content.attachment.entity

import jakarta.persistence.*

/** 이미지 변경을 작품 단위로 직렬화하는 기존 정본 행의 최소 매핑. */
@Entity
@Table(name = "work")
open class ImageWork(
    @Id @Column(length = 36) open var id: String = "",
    @Column(name = "owner_id", length = 200) open var ownerId: String = "",
    @Column(name = "deleted_at") open var deletedAt: java.time.Instant? = null,
)
