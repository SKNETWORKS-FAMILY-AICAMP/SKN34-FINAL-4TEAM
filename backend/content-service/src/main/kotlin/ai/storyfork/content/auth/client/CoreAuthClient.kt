package ai.storyfork.content.auth.client

import java.util.UUID
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.service.annotation.HttpExchange
import org.springframework.web.service.annotation.PostExchange

/** 콘텐츠 전용 로컬 초안: 경로·응답은 Core 계약 확정 전이며 실제 호출에 연결하지 않는다. */
@HttpExchange(accept = [MediaType.APPLICATION_JSON_VALUE])
interface CoreAuthClient {
    @PostExchange("/internal/v1/auth/verify")
    fun verify(@RequestHeader(HttpHeaders.AUTHORIZATION) authorization: String): VerifiedMemberResponse
}

/** Core AuthMember.id의 UUID 타입에 맞춘 제안 응답이며 기존 MemberResponse 계약이 아니다. */
data class VerifiedMemberResponse(val memberId: UUID)
