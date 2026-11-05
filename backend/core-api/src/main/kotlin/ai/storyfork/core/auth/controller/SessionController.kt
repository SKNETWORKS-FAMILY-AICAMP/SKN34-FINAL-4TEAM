package ai.storyfork.core.auth.controller

import ai.storyfork.core.auth.service.SessionService
import ai.storyfork.core.auth.service.dto.LoginRequest
import ai.storyfork.core.auth.service.dto.LoginResponse
import ai.storyfork.core.auth.service.dto.LoginResult
import ai.storyfork.core.auth.service.dto.SessionsResponse
import jakarta.validation.Valid
import java.time.Duration
import java.util.UUID
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseCookie
import org.springframework.http.ResponseEntity
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException

/** 로그인·refresh 세션의 HTTP 바인딩과 공개 DTO·HttpOnly 쿠키 변환을 담당한다. */
@RestController
@RequestMapping("/api/v1/auth")
class SessionController(private val service: SessionService, @Value("\${AUTH_COOKIE_SECURE:true}") private val secure: Boolean) {
    private fun cookie(token: String, maxAge: Duration): String =
        ResponseCookie.from("refresh_token", token).httpOnly(true).secure(secure)
            .sameSite("Strict").path("/api/v1/auth").maxAge(maxAge).build().toString()

    private fun result(login: LoginResult?): ResponseEntity<LoginResponse> {
        if (login == null) throw ResponseStatusException(HttpStatus.UNAUTHORIZED)
        return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, cookie(login.refreshToken, Duration.ofDays(14)))
            .body(LoginResponse(login.accessToken, login.user))
    }

    private fun member(jwt: Jwt): UUID = try { UUID.fromString(jwt.subject) } catch (_: IllegalArgumentException) { throw ResponseStatusException(HttpStatus.UNAUTHORIZED) }

    /** LoginRequest의 자격 증명으로 로그인하고 LoginResponse와 refresh 쿠키를 반환한다. 불일치는 401이다. */
    @PostMapping("/login")
    fun login(@Valid @RequestBody body: LoginRequest,
        @RequestHeader(name = "User-Agent", required = false) device: String?): ResponseEntity<LoginResponse> =
        result(service.login(body, device ?: "Unknown device"))

    /** refresh 쿠키를 회전해 LoginResponse를 반환한다. X-Auth-User는 계정 혼선 방지 조건이며 인증 주체가 아니고, 불일치·만료·재사용은 401이다. */
    @PostMapping("/refresh")
    fun refresh(@CookieValue(name = "refresh_token", required = false) token: String?,
        @RequestHeader(name = "X-Auth-User", required = false) expectedUser: UUID?): ResponseEntity<LoginResponse> =
        result(service.refresh(token, expectedUser))

    /** 쿠키의 세션을 폐기하고 204와 삭제 쿠키를 반환한다. 계정 사전조건 불일치는 쿠키를 보존한 채 409다. */
    @PostMapping("/logout")
    fun logout(@CookieValue(name = "refresh_token", required = false) token: String?,
        @RequestHeader(name = "X-Auth-User", required = false) expectedUser: UUID?): ResponseEntity<Void> {
        if (!service.logout(token, expectedUser)) throw ResponseStatusException(HttpStatus.CONFLICT)
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO)).build()
    }

    /** 검증된 JWT 회원의 유효 세션을 SessionsResponse로 반환하며 쿠키로 현재 기기를 표시한다. 인증 실패는 401이다. */
    @GetMapping("/sessions")
    fun sessions(@AuthenticationPrincipal jwt: Jwt,
        @CookieValue(name = "refresh_token", required = false) token: String?): SessionsResponse =
        service.sessions(member(jwt), token)

    /** 검증된 JWT 회원 소유 세션을 폐기한다. 다른 회원·이미 폐기된 세션은 404이며 성공은 204다. */
    @DeleteMapping("/sessions/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun revoke(@AuthenticationPrincipal jwt: Jwt, @PathVariable id: UUID) {
        if (!service.revoke(member(jwt), id)) throw ResponseStatusException(HttpStatus.NOT_FOUND)
    }

    /** 검증된 JWT 회원의 모든 refresh 세션을 폐기하고 204를 반환한다. 해당 회원 소유의 쿠키만 삭제한다. */
    @PostMapping("/logout-all")
    fun logoutAll(@AuthenticationPrincipal jwt: Jwt,
        @CookieValue(name = "refresh_token", required = false) token: String?): ResponseEntity<Void> {
        val response = ResponseEntity.noContent()
        if (service.logoutAll(member(jwt), token)) response.header(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO))
        return response.build()
    }
}
