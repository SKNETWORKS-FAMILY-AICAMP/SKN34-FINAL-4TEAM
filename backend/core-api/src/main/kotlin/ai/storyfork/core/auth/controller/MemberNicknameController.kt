package ai.storyfork.core.auth.controller

import ai.storyfork.core.auth.service.MemberNicknameService
import ai.storyfork.core.auth.service.dto.NicknamesRequest
import ai.storyfork.core.auth.service.dto.NicknamesResponse
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController

/** 내부 콘텐츠 서비스가 표시용 최신 닉네임을 회원 ID 묶음으로 조회한다. 서비스 자격만 쓰고 사용자 Bearer는 받지 않는다. */
@RestController
class MemberNicknameController(private val service: MemberNicknameService) {
    /** 최대 200개 UUID의 닉네임을 반환한다. 없는 회원은 빠지고 이용 제한 회원은 포함하며, 잘못된 UUID·200개 초과는 400이다. */
    @PostMapping("/internal/v1/members/nicknames")
    fun nicknames(@RequestBody body: NicknamesRequest): NicknamesResponse = service.nicknames(body.ids)
}
