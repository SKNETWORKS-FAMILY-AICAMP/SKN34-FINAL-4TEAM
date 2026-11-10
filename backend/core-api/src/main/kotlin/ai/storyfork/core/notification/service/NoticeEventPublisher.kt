package ai.storyfork.core.notification.service

import ai.storyfork.core.notification.service.dto.NoticeEventMessage

/** 알림 사건 한 건을 브로커로 내보내는 경계. 브로커가 받았다는 확인까지 끝나야 반환하고, 실패하면 예외를 던진다. */
fun interface NoticeEventPublisher {
    fun publish(message: NoticeEventMessage)
}
