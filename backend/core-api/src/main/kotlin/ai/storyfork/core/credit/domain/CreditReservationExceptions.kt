package ai.storyfork.core.credit.domain

/** 이미 정산·해제로 닫힌 예약을 다른 방식으로 닫거나 다시 예약하려 했다. 내부 API는 409 `RESERVATION_CLOSED`로 바꾼다. */
class ReservationClosedException(message: String) : IllegalStateException(message)

/** 없거나 다른 회원의 예약이다. 내부 API는 404 `RESERVATION_NOT_FOUND`로 바꾼다. */
class ReservationNotFoundException : NoSuchElementException("예약을 찾을 수 없습니다.")
