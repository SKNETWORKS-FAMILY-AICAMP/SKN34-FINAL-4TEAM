package ai.storyfork.core.auth.controller

import ai.storyfork.core.auth.service.dto.EmailRequest
import ai.storyfork.core.auth.service.dto.MemberResponse
import ai.storyfork.core.auth.service.dto.NicknameRequest
import ai.storyfork.core.auth.service.dto.ResetRequest
import ai.storyfork.core.auth.service.dto.TokenRequest
import ai.storyfork.core.auth.service.ProfileService
import jakarta.validation.Valid
import java.util.UUID
import org.springframework.http.HttpStatus
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.*
import org.springframework.web.server.ResponseStatusException

/** 회원 프로필·이메일 변경·비밀번호 복구의 입력 검증과 HTTP 응답 변환을 담당한다. */
@RestController
class ProfileController(private val profiles: ProfileService) {
    private fun member(jwt: Jwt): UUID = try { UUID.fromString(jwt.subject) } catch (_: IllegalArgumentException) { throw ResponseStatusException(HttpStatus.UNAUTHORIZED) }

    /** 검증된 JWT 회원의 허용 필드만 MemberResponse로 반환한다. 인증 또는 회원 조회 실패는 401이다. */
    @GetMapping("/api/v1/me")
    fun profile(@AuthenticationPrincipal jwt: Jwt): MemberResponse = profiles.profile(member(jwt))

    /** 검증된 JWT 회원의 NicknameRequest를 적용해 MemberResponse를 반환한다. 빈 닉네임은 400이다. */
    @PatchMapping("/api/v1/me")
    fun nickname(@AuthenticationPrincipal jwt: Jwt, @Valid @RequestBody request: NicknameRequest): MemberResponse = profiles.nickname(member(jwt), request)

    /** 검증된 JWT 회원이 EmailRequest의 새 주소에 확인 메일을 요청한다. 성공은 202, 중복은 409, SMTP 실패는 503이다. */
    @PostMapping("/api/v1/me/email-change")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun emailChange(@AuthenticationPrincipal jwt: Jwt, @Valid @RequestBody request: EmailRequest) = profiles.requestEmailChange(member(jwt), request)

    /** 익명 TokenRequest의 일회용 링크로 이메일을 확정한다. 성공은 204, 무효·만료는 400, 주소 충돌은 409다. */
    @PostMapping("/api/v1/auth/verify-email-change")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun verifyEmailChange(@Valid @RequestBody request: TokenRequest) = profiles.verifyEmailChange(request)

    /** 익명 EmailRequest로 복구 메일을 요청하며 회원 존재·SMTP 실패 여부와 무관하게 202를 반환한다. */
    @PostMapping("/api/v1/auth/forgot-password")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun forgotPassword(@Valid @RequestBody request: EmailRequest) = profiles.forgotPassword(request)

    /** 익명 ResetRequest의 일회용 링크로 비밀번호와 refresh 세션을 갱신한다. 성공은 204, 무효·만료는 400이다. */
    @PostMapping("/api/v1/auth/reset-password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun resetPassword(@Valid @RequestBody request: ResetRequest) = profiles.resetPassword(request)
}
