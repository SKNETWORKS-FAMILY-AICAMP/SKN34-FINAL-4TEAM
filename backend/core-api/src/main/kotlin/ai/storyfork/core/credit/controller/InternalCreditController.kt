package ai.storyfork.core.credit.controller

import ai.storyfork.core.credit.domain.InsufficientCreditException
import ai.storyfork.core.credit.domain.ReservationClosedException
import ai.storyfork.core.credit.domain.ReservationNotFoundException
import ai.storyfork.core.credit.service.AiRateLimitDecision
import ai.storyfork.core.credit.service.AiRateLimitService
import ai.storyfork.core.credit.service.CreditReservationService
import ai.storyfork.core.credit.service.dto.AiRateLimitRequest
import ai.storyfork.core.credit.service.dto.AiRateLimitResponse
import ai.storyfork.core.credit.service.dto.CreditReleaseRequest
import ai.storyfork.core.credit.service.dto.CreditReservationResponse
import ai.storyfork.core.credit.service.dto.CreditReserveRequest
import ai.storyfork.core.credit.service.dto.CreditSettleRequest
import org.springframework.http.HttpStatus
import org.springframework.http.HttpStatusCode
import org.springframework.http.MediaType
import org.springframework.http.ProblemDetail
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController

/**
 * Content가 AI 작업에 쓰는 크레딧 예약·정산·해제와 AI 요청 속도 제한 내부 API(F-CRD-01·03·05).
 * 서비스 토큰만 받고 사용자 Bearer는 받지 않는다. 회원 확인과 크레딧 환산은 호출한 쪽이 끝낸 값을 그대로 쓴다.
 * 예약·정산·해제는 같은 operationKey로 다시 불러도 결과가 같으므로 응답이 불확실하면 같은 요청을 다시 보내면 된다.
 * 속도 제한 확인(acquire)은 부를 때마다 한도를 가져가므로 다시 보내면 한도를 한 번 더 쓴다.
 * 호출 순서: 속도 제한 확인 → 예약 → AI 실행 → 성공이면 정산, 실패·시간 초과면 해제.
 */
@RestController
class InternalCreditController(
    private val reservations: CreditReservationService,
    private val rateLimits: AiRateLimitService,
) {
    /** 사용 가능한 잔액에서 예약한다. 잔액이 모자라면 409 `INSUFFICIENT_CREDIT`이고 아무것도 예약하지 않는다. 같은 키의 예약이 이미 닫혔으면 409 `RESERVATION_CLOSED`다. */
    @PostMapping("/internal/v1/credits/reservations")
    fun reserve(@RequestBody body: CreditReserveRequest): CreditReservationResponse =
        reservations.reserve(body.memberId, body.amount, body.operationKey)

    /** 실제 사용량만 차감한다. 없거나 다른 회원의 예약은 404, 이미 해제한 예약은 409다. */
    @PostMapping("/internal/v1/credits/reservations/settle")
    fun settle(@RequestBody body: CreditSettleRequest): CreditReservationResponse =
        reservations.settle(body.memberId, body.operationKey, body.actual)

    /** 차감 없이 푼다. 없거나 다른 회원의 예약은 404, 이미 정산한 예약은 409다. */
    @PostMapping("/internal/v1/credits/reservations/release")
    fun release(@RequestBody body: CreditReleaseRequest): CreditReservationResponse =
        reservations.release(body.memberId, body.operationKey)

    /** 받으면 한도를 가져가고, 아니면 아무것도 가져가지 않고 다시 시도할 시간을 준다. 예약보다 먼저 부른다. */
    @PostMapping("/internal/v1/ai-rate-limit/acquire")
    fun acquire(@RequestBody body: AiRateLimitRequest): AiRateLimitResponse =
        when (val decision = rateLimits.tryAcquire(body.memberId, body.tokens)) {
            AiRateLimitDecision.Allowed -> AiRateLimitResponse(true, null)
            is AiRateLimitDecision.Limited -> AiRateLimitResponse(false, decision.retryAfter.toMillis())
        }

    @ExceptionHandler(InsufficientCreditException::class)
    fun insufficient() = problem(HttpStatus.CONFLICT, "INSUFFICIENT_CREDIT", "사용 가능한 크레딧이 부족합니다.")

    @ExceptionHandler(ReservationNotFoundException::class)
    fun notFound() = problem(HttpStatus.NOT_FOUND, "RESERVATION_NOT_FOUND", "예약을 찾을 수 없습니다.")

    /** 이미 닫힌 예약을 다른 방식으로 닫거나 다시 예약하려 했다. 서비스의 고정 문구를 그대로 보여 준다.
     * 전용 예외만 받으므로 그 밖의 IllegalStateException(데이터 불일치 등)은 500으로 남는다. */
    @ExceptionHandler(ReservationClosedException::class)
    fun closed(error: ReservationClosedException) = problem(HttpStatus.CONFLICT, "RESERVATION_CLOSED", error.message.orEmpty())

    /** 금액·operationKey·토큰 수 규칙 위반. 서비스의 고정 문구만 담고 입력값은 담지 않는다. */
    @ExceptionHandler(IllegalArgumentException::class)
    fun invalid(error: IllegalArgumentException) = problem(HttpStatusCode.valueOf(422), "INVALID_CREDIT_REQUEST", error.message.orEmpty())

    private fun problem(status: HttpStatusCode, code: String, detail: String): ResponseEntity<ProblemDetail> =
        ResponseEntity.status(status).contentType(MediaType.APPLICATION_PROBLEM_JSON)
            .body(ProblemDetail.forStatusAndDetail(status, detail).apply { setProperty("code", code) })
}
