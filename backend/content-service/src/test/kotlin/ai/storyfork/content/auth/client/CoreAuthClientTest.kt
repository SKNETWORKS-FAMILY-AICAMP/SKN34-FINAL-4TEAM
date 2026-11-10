package ai.storyfork.content.auth.client

import ai.storyfork.content.auth.client.dto.NicknamesPayload
import ai.storyfork.content.auth.client.dto.NicknamesResponse
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.service.annotation.HttpExchange
import org.springframework.web.service.annotation.PostExchange

class CoreAuthClientTest {
    @Test
    fun `draft verification declares a header-only credential and UUID-only response`() {
        val client = Class.forName("ai.storyfork.content.auth.client.CoreAuthClient")
        assertTrue(client.isInterface)
        assertEquals(listOf(MediaType.APPLICATION_JSON_VALUE), client.getAnnotation(HttpExchange::class.java)?.accept?.toList())

        val verify = client.getDeclaredMethod("verify", String::class.java)
        assertEquals("/internal/v1/auth/verify", verify.getAnnotation(PostExchange::class.java)?.value)
        val header = verify.parameters.single().getAnnotation(RequestHeader::class.java)
        assertEquals(HttpHeaders.AUTHORIZATION, header?.value)
        assertEquals(true, header?.required)

        val response = verify.returnType
        assertEquals("ai.storyfork.content.auth.client.VerifiedMemberResponse", response.name)
        assertEquals(
            listOf("memberId" to UUID::class.java),
            response.declaredFields.filterNot { it.isSynthetic }.map { it.name to it.type },
        )
    }

    @Test
    fun `nickname lookup declares a JSON body and carries no user bearer`() {
        val nicknames = CoreAuthClient::class.java.getDeclaredMethod("nicknames", NicknamesPayload::class.java)
        assertEquals("/internal/v1/members/nicknames", nicknames.getAnnotation(PostExchange::class.java)?.value)
        // 요청 본문의 Content-Type을 추론에 맡기지 않고 JSON으로 선언한다.
        assertEquals(MediaType.APPLICATION_JSON_VALUE, nicknames.getAnnotation(PostExchange::class.java)?.contentType)
        // 사용자 Bearer 없이 서비스 토큰(HTTP proxy 기본 헤더)만 보내므로 요청 본문 말고는 파라미터가 없다.
        assertNotNull(nicknames.parameters.single().getAnnotation(RequestBody::class.java))
        assertEquals(NicknamesResponse::class.java, nicknames.returnType)
        assertEquals(listOf("ids" to List::class.java), NicknamesPayload::class.java.declaredFields.filterNot { it.isSynthetic }.map { it.name to it.type })
        assertEquals(listOf("nicknames" to Map::class.java), NicknamesResponse::class.java.declaredFields.filterNot { it.isSynthetic }.map { it.name to it.type })
    }
}
