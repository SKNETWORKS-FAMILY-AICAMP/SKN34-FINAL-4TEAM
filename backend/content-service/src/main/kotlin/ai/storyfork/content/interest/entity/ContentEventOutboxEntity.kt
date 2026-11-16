package ai.storyfork.content.interest.entity

import jakarta.persistence.*
import java.time.Instant
import java.util.UUID

/** 브로커로 보낼 알림 사건 한 건. id가 사건 계약의 eventId이고 [publishedAt]이 비어 있는 동안 발행 대기다. */
@Entity
@Table(name = "content_event_outbox")
class ContentEventOutboxEntity(
    @field:Id @field:Column(name = "id")
    var id: UUID = UUID(0, 0),
    @field:Column(name = "type")
    var type: String = "",
    @field:Column(name = "recipient_id")
    var recipientId: String = "",
    @field:Column(name = "target_type")
    var targetType: String = "",
    @field:Column(name = "target_id")
    var targetId: String = "",
    @field:Column(name = "occurred_at")
    var occurredAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
    @field:Column(name = "published_at")
    var publishedAt: Instant? = null,
)
