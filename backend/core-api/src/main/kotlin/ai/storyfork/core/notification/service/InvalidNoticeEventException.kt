package ai.storyfork.core.notification.service

/** 다시 시도해도 처리할 수 없는 사건 메시지(계약 위반). 재시도하지 않고 DLQ로 보낸다. */
class InvalidNoticeEventException(message: String) : RuntimeException(message)
