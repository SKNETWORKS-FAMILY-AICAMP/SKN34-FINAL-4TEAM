package ai.storyfork.content.auth.client

import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
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
}
