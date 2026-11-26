package ai.storyfork.core.notification.service.dto

import ai.storyfork.core.notification.domain.NoticeDetail

/** RabbitMQ로 받는 알림 사건 메시지. 모든 필드를 느슨하게 받고 NoticeEventService가 검증한다. */
data class NoticeEventMessage(
    val schemaVersion: Int? = null,
    val eventId: String? = null,
    val type: String? = null,
    val occurredAt: String? = null,
    val recipientId: String? = null,
    val target: NoticeEventTarget? = null,
    /** 문구를 구체화하는 선택 정보(#941). 없으면 사건 종류의 기본 문구다. */
    val detail: NoticeDetail? = null,
)
