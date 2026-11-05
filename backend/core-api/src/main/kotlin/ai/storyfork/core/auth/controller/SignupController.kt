package ai.storyfork.core.auth.controller

import ai.storyfork.core.auth.service.dto.CsrfResponse
import ai.storyfork.core.auth.service.dto.EmailRequest
import ai.storyfork.core.auth.service.dto.SignupRequest
import ai.storyfork.core.auth.service.dto.VerificationRequest
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

/** 익명 가입·메일 인증 요청을 검증하고 Service 결과를 HTTP 상태와 공개 DTO로 표현한다. */
@RestController
@RequestMapping("/api/v1/auth")
class SignupController(private val service: SignupService) {
    /** 익명 클라이언트에 변경 요청용 CSRF 토큰을 CsrfResponse와 쿠키로 제공한다. */
    @GetMapping("/csrf")
    fun csrf(token: CsrfToken): CsrfResponse = CsrfResponse(token.token)

    /** SignupRequest로 가입 후보와 인증 메일을 요청한다. 성공은 202, 중복 회원은 409, SMTP 실패는 503이다. */
    @PostMapping("/signup")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun signup(@Valid @RequestBody request: SignupRequest) = service.signup(request)

    /** EmailRequest로 인증 메일을 재요청하며 후보 존재·메일 실패 여부를 드러내지 않고 202를 반환한다. */
    @PostMapping("/resend-verification")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun resend(@Valid @RequestBody request: EmailRequest) = service.resend(request)

    /** VerificationRequest의 최신 토큰과 가입 비밀번호로 회원을 생성한다. 성공은 204, 잘못된 증명·만료는 400이다. */
    @PostMapping("/verify-email")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun verify(@Valid @RequestBody request: VerificationRequest) = service.verify(request)
}
