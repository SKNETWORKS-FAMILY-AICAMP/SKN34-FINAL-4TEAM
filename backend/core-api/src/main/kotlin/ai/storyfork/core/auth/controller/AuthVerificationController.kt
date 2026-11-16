package ai.storyfork.core.auth.controller

import ai.storyfork.core.auth.service.AuthVerificationService
import ai.storyfork.core.auth.service.dto.VerifiedMemberResponse
import ai.storyfork.core.auth.service.dto.ScheduledMemberRequest
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController

/** 내부 콘텐츠 서비스의 사용자 인증 확인만 제공하며 콘텐츠 요청을 중계하지 않는다. */
@RestController
class AuthVerificationController(private val service: AuthVerificationService) {
    /** 별도 서비스 자격과 기존 JWT 검증을 통과한 회원 UUID만 반환한다. 무효 사용자 인증은 401이다. */
    @PostMapping("/internal/v1/auth/verify")
    fun verify(@AuthenticationPrincipal jwt: Jwt): VerifiedMemberResponse = service.verify(jwt.subject)

    /** 사전 승인한 예약 발행 실행에 앞서 회원 제한·존재 여부를 서비스 자격으로 재검증한다. */
    @PostMapping("/internal/v1/auth/verify-scheduled-member")
    fun verifyScheduledMember(@RequestBody request: ScheduledMemberRequest): VerifiedMemberResponse = service.verify(request.memberId)
}
