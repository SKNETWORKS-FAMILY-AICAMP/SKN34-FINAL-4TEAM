package ai.storyfork.core.auth.service

/** 인증·회원 업무 실패를 나타낸다. HTTP 상태 변환은 controller 계층의 AuthExceptionHandler가 맡는다. */
class AuthException(val reason: Reason) : RuntimeException(reason.name) {
    /** 실패 사유. 요청 오류, 인증 실패, 권한 없음, 대상 없음, 상태 충돌, 일시적 이용 불가를 구분한다. */
    enum class Reason { INVALID, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, UNAVAILABLE }
}
