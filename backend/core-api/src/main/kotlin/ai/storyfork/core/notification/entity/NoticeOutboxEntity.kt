package ai.storyfork.core.notification.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.util.UUID

/** 아직 브로커로 보내지 못했거나 보낸 알림 사건 한 건. id가 계약의 eventId라 재전송해도 같은 값이 나간다. */
@Entity
@Table(name = "notification_outbox")
class NoticeOutboxEntity(
    @Id val id: UUID,
    @Column(name = "event_type", nullable = false, length = 60) val eventType: String,
    @Column(name = "recipient_id", nullable = false) val recipientId: UUID,
    @Column(name = "target_type", nullable = false, length = 40) val targetType: String,
    @Column(name = "target_id", nullable = false, length = 100) val targetId: String,
    @Column(name = "occurred_at", nullable = false) val occurredAt: Instant,
    @Column(nullable = false, length = 20) var status: String = PENDING,
    @Column(nullable = false) var attempts: Int = 0,
    @Column(name = "next_attempt_at", nullable = false) var nextAttemptAt: Instant,
    @Column(name = "last_error", length = 200) var lastError: String? = null,
    @Column(name = "sent_at") var sentAt: Instant? = null,
) {
    companion object {
        const val PENDING = "PENDING"
        const val SENT = "SENT"
        const val FAILED = "FAILED"
    }
}
