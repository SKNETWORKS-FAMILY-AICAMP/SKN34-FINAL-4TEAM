package ai.storyfork.core.auth.controller

import ai.storyfork.core.auth.service.MemberNicknameService
import ai.storyfork.core.auth.service.dto.NicknamesRequest
import ai.storyfork.core.auth.service.dto.NicknamesResponse
import jakarta.validation.Valid
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController

/** Content 서비스 전용 회원 닉네임 일괄 조회. 사용자 Bearer 없이 `X-Content-Service-Token`만 요구한다(운영 토큰은 거절). */
@RestController
class MemberNicknameController(private val service: MemberNicknameService) {
    /** UUID 1~200개의 닉네임 맵을 반환한다. 없는 회원은 맵에서 빠지고, 개수 범위·UUID 형식 오류는 400이다. */
    @PostMapping("/internal/v1/members/nicknames")
    fun nicknames(@Valid @RequestBody body: NicknamesRequest): NicknamesResponse = service.nicknames(body.ids)
}
