package ai.storyfork.core.auth.controller

import ai.storyfork.core.auth.service.ProfileService
import ai.storyfork.core.auth.service.SessionService
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import java.util.UUID
import org.springframework.http.HttpStatus
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException

@RestController
class ProfileController(private val sessions: SessionService, private val profiles: ProfileService) {
    data class NicknameRequest(@field:NotBlank @field:Size(max = 80) val nickname: String)
    data class ResetRequest(@field:NotBlank @field:Size(max = 128) val token: String, @field:NotBlank @field:Size(min = 8, max = 72) val newPassword: String)
    private fun member(jwt: Jwt): UUID = try { UUID.fromString(jwt.subject) } catch (_: IllegalArgumentException) { throw ResponseStatusException(HttpStatus.UNAUTHORIZED) }

    @GetMapping("/api/v1/me")
    fun profile(@AuthenticationPrincipal jwt: Jwt): SessionService.User = sessions.memberById(member(jwt)) ?: throw ResponseStatusException(HttpStatus.UNAUTHORIZED)

    @PatchMapping("/api/v1/me")
    fun nickname(@AuthenticationPrincipal jwt: Jwt, @Valid @RequestBody request: NicknameRequest): SessionService.User = profiles.nickname(member(jwt), request.nickname)

    @PostMapping("/api/v1/me/email-change")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun emailChange(@AuthenticationPrincipal jwt: Jwt, @Valid @RequestBody request: SignupController.EmailRequest) = profiles.requestEmailChange(member(jwt), request.email)

    @PostMapping("/api/v1/auth/verify-email-change")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun verifyEmailChange(@Valid @RequestBody request: SignupController.TokenRequest) = profiles.verifyEmailChange(request.token)

    @PostMapping("/api/v1/auth/forgot-password")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun forgotPassword(@Valid @RequestBody request: SignupController.EmailRequest) = profiles.forgotPassword(request.email)

    @PostMapping("/api/v1/auth/reset-password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun resetPassword(@Valid @RequestBody request: ResetRequest) = profiles.resetPassword(request.token, request.newPassword)
}
