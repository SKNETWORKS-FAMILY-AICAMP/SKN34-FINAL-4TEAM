package ai.storyfork.core.notification.service.dto

/** RabbitMQ로 받는 알림 사건 메시지. 모든 필드를 느슨하게 받고 NoticeEventService가 검증한다. */
data class NoticeEventMessage(
    val schemaVersion: Int? = null,
    val eventId: String? = null,
    val type: String? = null,
    val occurredAt: String? = null,
    val recipientId: String? = null,
    val target: NoticeEventTarget? = null,
)
