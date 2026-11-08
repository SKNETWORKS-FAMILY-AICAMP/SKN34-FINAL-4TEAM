package ai.storyfork.core.notification.service

/** 알림 업무 실패를 나타낸다. HTTP 상태 변환은 controller 계층의 NoticeExceptionHandler가 맡는다. */
class NoticeException(val reason: Reason) : RuntimeException(reason.name) {
    /** 실패 사유. 요청 오류, 인증 실패, 대상 없음을 구분한다. */
    enum class Reason { INVALID, UNAUTHENTICATED, NOT_FOUND }
}
