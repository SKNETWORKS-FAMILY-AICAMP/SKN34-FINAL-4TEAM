package ai.storyfork.core.auth.controller

import ai.storyfork.core.auth.controller.dto.EmailRequest
import ai.storyfork.core.auth.controller.dto.SignupRequest
import ai.storyfork.core.auth.controller.dto.VerificationRequest
import ai.storyfork.core.auth.service.SignupService
import jakarta.validation.Valid
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
