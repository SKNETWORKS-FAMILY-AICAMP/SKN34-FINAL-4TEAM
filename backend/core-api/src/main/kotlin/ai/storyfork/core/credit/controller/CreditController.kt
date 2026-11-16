package ai.storyfork.core.credit.controller

import ai.storyfork.core.credit.service.CreditService
import ai.storyfork.core.credit.service.dto.CreditBalanceResponse
import ai.storyfork.core.credit.service.dto.CreditHistoryResponse
import java.util.UUID
import org.springframework.http.HttpStatus
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException

/** 로그인한 회원 본인의 크레딧 잔액과 지급·사용·소멸 내역을 조회한다. */
@RestController
class CreditController(private val credits: CreditService) {
    private fun member(jwt: Jwt): UUID = try { UUID.fromString(jwt.subject) } catch (_: IllegalArgumentException) { throw ResponseStatusException(HttpStatus.UNAUTHORIZED) }

    /** 사용 가능한 크레딧 합계와 지급분별 남은 양·소멸 예정 시각을 반환한다. */
    @GetMapping("/api/v1/me/credits")
    fun balance(@AuthenticationPrincipal jwt: Jwt): CreditBalanceResponse = credits.balance(member(jwt))

    /** 본인의 지급·사용·소멸 내역을 최신순으로 반환한다. */
    @GetMapping("/api/v1/me/credits/history")
    fun history(@AuthenticationPrincipal jwt: Jwt): CreditHistoryResponse = credits.history(member(jwt))
}
