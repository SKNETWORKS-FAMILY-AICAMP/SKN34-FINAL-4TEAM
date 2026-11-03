package ai.storyfork.core.auth.controller

import ai.storyfork.core.auth.service.SessionService
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import java.time.Duration
import java.util.UUID
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseCookie
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException

@RestController
@RequestMapping("/api/v1/auth")
class SessionController(private val service: SessionService, @Value("\${AUTH_COOKIE_SECURE:true}") private val secure: Boolean) {
    data class LoginRequest(@field:NotBlank @field:Size(max = 254) val email: String, @field:NotBlank @field:Size(max = 72) val password: String)
    data class LoginResponse(val accessToken: String, val user: SessionService.User)
    private fun cookie(request: HttpServletRequest): String? = request.cookies?.firstOrNull { it.name == "refresh_token" }?.value
    private fun setCookie(response: HttpServletResponse, token: String, maxAge: Duration) {
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from("refresh_token", token).httpOnly(true).secure(secure)
            .sameSite("Strict").path("/api/v1/auth").maxAge(maxAge).build().toString())
    }
    private fun result(login: SessionService.Login?, response: HttpServletResponse): LoginResponse {
        if (login == null) throw ResponseStatusException(HttpStatus.UNAUTHORIZED)
        setCookie(response, login.refreshToken, Duration.ofDays(14))
        return LoginResponse(login.accessToken, login.user)
    }
    private fun member(jwt: Jwt): UUID = try { UUID.fromString(jwt.subject) } catch (_: Exception) { throw ResponseStatusException(HttpStatus.UNAUTHORIZED) }

    @PostMapping("/login")
    fun login(@Valid @RequestBody body: LoginRequest, request: HttpServletRequest, response: HttpServletResponse): LoginResponse =
        result(service.login(body.email, body.password, request.getHeader("User-Agent") ?: "Unknown device"), response)

    @PostMapping("/refresh")
    fun refresh(request: HttpServletRequest, response: HttpServletResponse,
        @RequestHeader(name = "X-Auth-User", required = false) expectedUser: UUID?): LoginResponse =
        result(service.refresh(cookie(request), expectedUser), response)

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun logout(request: HttpServletRequest, response: HttpServletResponse,
        @RequestHeader(name = "X-Auth-User", required = false) expectedUser: UUID?) {
        if (!service.logout(cookie(request), expectedUser)) throw ResponseStatusException(HttpStatus.CONFLICT)
        setCookie(response, "", Duration.ZERO)
    }

    @GetMapping("/sessions")
    fun sessions(@AuthenticationPrincipal jwt: Jwt, request: HttpServletRequest): Map<String, List<SessionService.Session>> =
        mapOf("sessions" to service.sessions(member(jwt), cookie(request)))

    @DeleteMapping("/sessions/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun revoke(@AuthenticationPrincipal jwt: Jwt, @PathVariable id: UUID) {
        if (!service.revoke(member(jwt), id)) throw ResponseStatusException(HttpStatus.NOT_FOUND)
    }

    @PostMapping("/logout-all")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun logoutAll(@AuthenticationPrincipal jwt: Jwt, request: HttpServletRequest, response: HttpServletResponse) {
        if (service.logoutAll(member(jwt), cookie(request))) setCookie(response, "", Duration.ZERO)
    }
}
