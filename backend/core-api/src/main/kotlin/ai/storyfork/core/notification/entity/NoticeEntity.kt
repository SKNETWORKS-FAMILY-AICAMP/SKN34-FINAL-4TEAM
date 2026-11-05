package ai.storyfork.core.notification.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.util.UUID

/** 회원별 알림함 행. 삭제는 행을 지우지 않고 deletedAt으로 표시해 재전달로 되살아나지 않게 한다. */
@Entity
@Table(name = "notification")
class NoticeEntity(
    @Id val id: UUID,
    @Column(name = "recipient_id", nullable = false) val recipientId: UUID,
    @Column(nullable = false, length = 40) val kind: String,
    @Column(nullable = false, length = 300) val summary: String,
    @Column(name = "target_type", length = 40) val targetType: String? = null,
    @Column(name = "target_id", length = 100) val targetId: String? = null,
    @Column(name = "created_at", nullable = false) val createdAt: Instant,
    @Column(name = "read_at") var readAt: Instant? = null,
    @Column(name = "deleted_at") var deletedAt: Instant? = null,
)
