package ai.storyfork.content.auth.client

import ai.storyfork.content.auth.client.dto.NicknamesPayload
import ai.storyfork.content.auth.client.dto.NicknamesResult
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.service.annotation.HttpExchange
import org.springframework.web.service.annotation.PostExchange

class CoreMemberClientTest {
    @Test
    fun `nickname lookup posts a JSON id list and sends no user credential`() {
        val client = Class.forName("ai.storyfork.content.auth.client.CoreMemberClient")
        assertTrue(client.isInterface)
        assertEquals(listOf(MediaType.APPLICATION_JSON_VALUE), client.getAnnotation(HttpExchange::class.java)?.accept?.toList())

        val lookup = client.declaredMethods.single()
        val exchange = lookup.getAnnotation(PostExchange::class.java)
        assertEquals("/internal/v1/members/nicknames", exchange?.value)
        assertEquals(MediaType.APPLICATION_JSON_VALUE, exchange?.contentType)
        // 서비스 자격은 HTTP proxy 설정이 주입한다. 사용자 Bearer 헤더 매개변수는 없고 본문 하나뿐이다.
        val body = lookup.parameters.single()
        assertNotNull(body.getAnnotation(RequestBody::class.java))
        assertNull(body.getAnnotation(RequestHeader::class.java))
        assertEquals(NicknamesPayload::class.java, body.type)
        assertEquals(NicknamesResult::class.java, lookup.returnType)

        assertEquals(listOf("ids" to List::class.java), NicknamesPayload::class.java.declaredFields.filterNot { it.isSynthetic }.map { it.name to it.type })
        assertEquals(listOf("nicknames" to Map::class.java), NicknamesResult::class.java.declaredFields.filterNot { it.isSynthetic }.map { it.name to it.type })
    }
}
