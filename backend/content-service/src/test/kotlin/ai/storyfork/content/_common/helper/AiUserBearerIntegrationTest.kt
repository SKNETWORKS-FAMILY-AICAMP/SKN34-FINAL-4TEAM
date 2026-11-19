package ai.storyfork.content._common.helper

import ai.storyfork.content._common.ai_config.AiServiceClientProperties
import ai.storyfork.content.work.WorkTagSuggestionConfig
import ai.storyfork.content.work.client.WorkTagSuggestionClient
import ai.storyfork.content.work.client.dto.WorkTagEpisode
import ai.storyfork.content.work.client.dto.WorkTagSuggestionInput
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.URI
import java.time.Duration
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.web.client.RestClient
import org.springframework.web.context.request.RequestContextHolder
import org.springframework.web.context.request.ServletRequestAttributes

/**
 * AI 호출이 처리 중인 요청의 회원 Bearer를 실제 전송에서 X-User-Authorization으로 싣는지 loopback HTTP 대역으로 확인한다(DEC-55).
 * 클라이언트는 설정이 만든 것을 쓴다. 인터셉터 규칙은 UserBearerInterceptorTest, 클라이언트별 배선은 AiUserBearerWiringTest가 본다.
 */
class AiUserBearerIntegrationTest {
    private val input = WorkTagSuggestionInput("work-tags.v1", "제목", "소개", listOf(WorkTagEpisode(1, "1화", "본문")), listOf("고전"), 2, 10)

    @AfterEach fun clear() = RequestContextHolder.resetRequestAttributes()

    /** loopback AI가 받은 X-User-Authorization 값이다(헤더가 없으면 null). */
    private fun received(call: (WorkTagSuggestionClient) -> Unit): List<String?> {
        val seen = mutableListOf<String?>()
        val http = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        http.createContext("/") { exchange ->
            seen += exchange.requestHeaders.getFirst(USER_AUTHORIZATION_HEADER)
            val bytes = """{"schemaVersion":"work-tags.v1","genres":["고전"],"hashtags":["장돌뱅이"]}""".toByteArray()
            exchange.responseHeaders.add("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        http.start()
        try {
            val ai = AiServiceClientProperties(URI("http://127.0.0.1:${http.address.port}"), Duration.ofSeconds(1), Duration.ofSeconds(5))
            call(WorkTagSuggestionConfig().workTagSuggestionClient(RestClient.builder(), ai, "token"))
        } finally { http.stop(0) }
        return seen
    }

    @Test fun `a request the member started sends the member's bearer to the AI and a call without a request sends none`() {
        RequestContextHolder.setRequestAttributes(ServletRequestAttributes(MockHttpServletRequest().apply { addHeader("Authorization", "Bearer member-token") }))
        assertEquals(listOf<String?>("Bearer member-token"), received { it.suggest(input) })

        RequestContextHolder.resetRequestAttributes()
        assertEquals(listOf<String?>(null), received { it.suggest(input) })
    }
}
