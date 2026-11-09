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
    fun `draft verification declares a header-only credential and a UUID plus nickname response`() {
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
        // 닉네임은 댓글 작성자 표시명 스냅샷용이며 없어도(구버전 Core) 확인은 성공해야 하므로 기본값 null이다.
        assertEquals(
            listOf("memberId" to UUID::class.java, "nickname" to String::class.java),
            response.declaredFields.filterNot { it.isSynthetic }.map { it.name to it.type },
        )
        assertEquals(null, VerifiedMemberResponse(UUID.randomUUID()).nickname)
    }
}
