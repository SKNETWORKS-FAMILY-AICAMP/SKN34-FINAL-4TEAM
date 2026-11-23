package ai.storyfork.core.credit.controller

import ai.storyfork.core.credit.domain.InsufficientCreditException
import ai.storyfork.core.credit.service.CreditAdminService
import ai.storyfork.core.credit.service.InvalidCreditAdjustmentException
import ai.storyfork.core.credit.service.dto.CreditAdjustRequest
import ai.storyfork.core.credit.service.dto.CreditBalanceResponse
import ai.storyfork.core.credit.service.dto.CreditBalancesRequest
import ai.storyfork.core.credit.service.dto.MemberCreditBalance
import ai.storyfork.core.credit.service.dto.MemberCreditsResponse
import java.util.UUID
import org.springframework.http.HttpStatus
import org.springframework.http.HttpStatusCode
import org.springframework.http.MediaType
import org.springframework.http.ProblemDetail
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

/**
 * 운영 서비스 전용 회원 크레딧 조회·수동 지급·수동 회수(DEC-57)와 묶음 잔액 조회. 운영 서비스 토큰과 operator 회원 Bearer가 필요하다(아니면 403).
 * 권한·대상 없음 실패(401·403·404)는 AuthExceptionHandler가 회원 관리 API와 같은 상태로 바꾼다.
 */
@RestController
@RequestMapping("/internal/v1/credits")
class CreditAdminController(private val admin: CreditAdminService) {
    /** 회원의 잔액(`me/credits`와 같은 모양)과 내역(`me/credits/history`와 같은 모양)을 반환한다. 없는 회원은 404다. */
    @GetMapping("/members/{memberId}")
    fun view(@AuthenticationPrincipal jwt: Jwt, @PathVariable memberId: UUID): MemberCreditsResponse = admin.view(jwt.subject, memberId)

    /** `operator` 종류로 지급하고 201과 갱신된 잔액을 반환한다. 금액·사유 규칙 위반은 422, 없는 회원은 404다. */
    @PostMapping("/members/{memberId}/grants")
    @ResponseStatus(HttpStatus.CREATED)
    fun grant(@AuthenticationPrincipal jwt: Jwt, @PathVariable memberId: UUID, @RequestBody body: CreditAdjustRequest): CreditBalanceResponse =
        admin.grant(jwt.subject, memberId, body)

    /** 쓸 수 있는 잔액 안에서 회수하고 201과 갱신된 잔액을 반환한다. 넘으면 409 `CREDIT_INSUFFICIENT`이고 아무것도 바꾸지 않는다. 규칙 위반은 422, 없는 회원은 404다. */
    @PostMapping("/members/{memberId}/revocations")
    @ResponseStatus(HttpStatus.CREATED)
    fun revoke(@AuthenticationPrincipal jwt: Jwt, @PathVariable memberId: UUID, @RequestBody body: CreditAdjustRequest): CreditBalanceResponse =
        admin.revoke(jwt.subject, memberId, body)

    /** 회원 최대 100명의 사용 가능한 크레딧 합계를 반환한다. 없는 회원은 빠지고 순서는 정해져 있지 않으며, 100명을 넘으면 422다. */
    @PostMapping("/balances")
    fun balances(@AuthenticationPrincipal jwt: Jwt, @RequestBody body: CreditBalancesRequest): List<MemberCreditBalance> =
        admin.balances(jwt.subject, body.memberIds)

    /** 회수할 수 있는 잔액이 모자라다. 잔액 숫자는 응답에 싣지 않는다. */
    @ExceptionHandler(InsufficientCreditException::class)
    fun insufficient() = problem(HttpStatus.CONFLICT, "CREDIT_INSUFFICIENT", "회수할 수 있는 크레딧이 부족합니다.")

    /** 금액·사유·회원 수 규칙 위반. 서비스의 고정 문구만 담고 입력값은 담지 않는다. 전용 예외만 받는다: 경로의 잘못된 UUID처럼 원인 사슬에 IllegalArgumentException이 있는 프레임워크 오류는 그대로 400이다. */
    @ExceptionHandler(InvalidCreditAdjustmentException::class)
    fun invalid(error: InvalidCreditAdjustmentException) = problem(HttpStatusCode.valueOf(422), "INVALID_CREDIT_REQUEST", error.message.orEmpty())

    private fun problem(status: HttpStatusCode, code: String, detail: String): ResponseEntity<ProblemDetail> =
        ResponseEntity.status(status).contentType(MediaType.APPLICATION_PROBLEM_JSON)
            .body(ProblemDetail.forStatusAndDetail(status, detail).apply { setProperty("code", code) })
}
