package ai.storyfork.content.auth.client

import java.util.UUID
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.service.annotation.HttpExchange
import org.springframework.web.service.annotation.PostExchange

/** 사용자 Bearer를 Core에 확인한다. 별도 서비스 자격은 HTTP proxy 설정이 주입한다. */
@HttpExchange(accept = [MediaType.APPLICATION_JSON_VALUE])
interface CoreAuthClient {
    @PostExchange("/internal/v1/auth/verify")
    fun verify(@RequestHeader(HttpHeaders.AUTHORIZATION) authorization: String): VerifiedMemberResponse
}

/** Core의 내부 확인 응답이며 공개 MemberResponse나 회원 정본 사본이 아니다. */
data class VerifiedMemberResponse(val memberId: UUID)
