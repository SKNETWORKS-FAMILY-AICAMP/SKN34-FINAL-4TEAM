package ai.storyfork.content.auth.client

import ai.storyfork.content.auth.client.dto.NicknamesPayload
import ai.storyfork.content.auth.client.dto.NicknamesResult
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.service.annotation.HttpExchange
import org.springframework.web.service.annotation.PostExchange

/** Core 회원 정보 조회. 별도 서비스 자격(`X-Content-Service-Token`)은 HTTP proxy 설정이 주입하며 사용자 Bearer는 보내지 않는다. */
@HttpExchange(accept = [MediaType.APPLICATION_JSON_VALUE])
interface CoreMemberClient {
    @PostExchange("/internal/v1/members/nicknames", contentType = MediaType.APPLICATION_JSON_VALUE)
    fun nicknames(@RequestBody body: NicknamesPayload): NicknamesResult
}
