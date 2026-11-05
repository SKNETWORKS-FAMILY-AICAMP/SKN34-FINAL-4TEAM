package ai.storyfork.core.auth.controller

import ai.storyfork.core.auth.service.WithdrawalService
import ai.storyfork.core.auth.service.dto.WithdrawalRequest
import ai.storyfork.core.auth.service.dto.WithdrawalResponse
import jakarta.validation.Valid
import java.util.UUID
import org.springframework.http.HttpStatus
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException

/** 로그인한 회원의 탈퇴 요청·상태 조회·유예 중 복구를 처리한다. */
@RestController
class WithdrawalController(private val withdrawals: WithdrawalService) {
    private fun member(jwt: Jwt): UUID = try { UUID.fromString(jwt.subject) } catch (_: IllegalArgumentException) { throw ResponseStatusException(HttpStatus.UNAUTHORIZED) }

    /** 비밀번호 확인 후 30일 유예 탈퇴를 요청한다. 성공은 202, 비밀번호 불일치는 403, 이미 진행 중이면 409다. */
    @PostMapping("/api/v1/me/withdrawal")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun request(@AuthenticationPrincipal jwt: Jwt, @Valid @RequestBody request: WithdrawalRequest): WithdrawalResponse = withdrawals.request(member(jwt), request)

    /** 진행 중인 탈퇴 요청 상태를 반환한다. 없으면 status가 NONE이다. */
    @GetMapping("/api/v1/me/withdrawal")
    fun status(@AuthenticationPrincipal jwt: Jwt): WithdrawalResponse = withdrawals.status(member(jwt))

    /** 유예 중인 탈퇴 요청을 취소한다. 성공은 204, 진행 중인 요청이 없으면 404다. */
    @DeleteMapping("/api/v1/me/withdrawal")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun restore(@AuthenticationPrincipal jwt: Jwt) = withdrawals.restore(member(jwt))
}
