package ai.storyfork.core.auth.controller

import ai.storyfork.core.auth.service.SignupService
import jakarta.validation.Valid
import jakarta.validation.constraints.Email
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.springframework.http.HttpStatus
import org.springframework.security.web.csrf.CsrfToken
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/v1/auth")
class SignupController(private val service: SignupService) {
    data class SignupRequest(
        @field:NotBlank @field:Email @field:Size(max = 254) val email: String,
        @field:NotBlank @field:Size(min = 8, max = 72) val password: String,
        @field:NotBlank @field:Size(max = 80) val nickname: String,
    )
    data class EmailRequest(@field:NotBlank @field:Email @field:Size(max = 254) val email: String)
    data class TokenRequest(@field:NotBlank @field:Size(max = 128) val token: String)
    data class VerificationRequest(
        @field:NotBlank @field:Size(max = 128) val token: String,
        @field:NotBlank @field:Size(min = 8, max = 72) val password: String,
    )

    @GetMapping("/csrf")
    fun csrf(token: CsrfToken): Map<String, String> = mapOf("csrfToken" to token.token)

    @PostMapping("/signup")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun signup(@Valid @RequestBody request: SignupRequest) = service.signup(request.email, request.password, request.nickname)

    @PostMapping("/resend-verification")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun resend(@Valid @RequestBody request: EmailRequest) = service.resend(request.email)

    @PostMapping("/verify-email")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun verify(@Valid @RequestBody request: VerificationRequest) = service.verify(request.token, request.password)
}
