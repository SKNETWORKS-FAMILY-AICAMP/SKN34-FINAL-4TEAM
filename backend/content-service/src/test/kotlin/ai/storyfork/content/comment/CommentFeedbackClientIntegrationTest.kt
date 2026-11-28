package ai.storyfork.content.comment

import ai.storyfork.content._common.ai_config.AiServiceClientProperties
import ai.storyfork.content.comment.client.CommentFeedbackClient
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.URI
import java.time.Duration
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.web.client.*

/** 실제 loopback HTTP로 내부 토큰, HTTP 상태와 읽기 시간 제한 전달을 검사한다. */
class CommentFeedbackClientIntegrationTest {
    @org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable(named="TEST_FEEDBACK_AI_URL",matches=".+")
    @Test fun `service batch matches legacy response for the same body`() {
        val client = CommentFeedbackClient(RestClient.builder(),AiServiceClientProperties(
            URI(System.getenv("TEST_FEEDBACK_AI_URL")),Duration.ofSeconds(5),Duration.ofSeconds(60)),"local-synthetic-only")
        val input = mapOf("one" to "이 문장은 맞춤법이 틀렸어요.","two" to "캐릭터의 감정 변화가 설득력 있게 묘사됐어요.")
        val rows = client.classifyBatch(input)
        assertEquals(input.keys, rows.keys)
        assertEquals("typo",rows.getValue("one").primaryAspect)
        assertEquals("character",rows.getValue("two").primaryAspect)
        input.forEach { (id,body) -> assertEquals(client.classify(body).isFeedback, rows.getValue(id).isFeedback) }
    }
    @Test fun `AI HTTP failures and timeouts reach worker`() {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1",0),0)
        val mode = java.util.concurrent.atomic.AtomicInteger(403)
        server.createContext("/internal/v1/comments/feedback") { exchange ->
            exchange.use {
                require(it.requestHeaders.getFirst("X-Internal-Token") == "test-token")
                it.requestBody.readAllBytes()
                val status = mode.get()
                if (status == 504) Thread.sleep(1200)
                runCatching { it.sendResponseHeaders(status, -1) }
            }
        }
        server.start()
        try {
            fun client(timeout: Duration) = CommentFeedbackClient(RestClient.builder(), AiServiceClientProperties(
                URI("http://127.0.0.1:${server.address.port}"), Duration.ofSeconds(1),timeout), "test-token")
            val http = client(Duration.ofSeconds(10))
            assertEquals(403,assertThrows(RestClientResponseException::class.java) { http.classify("댓글") }.statusCode.value())
            mode.set(503)
            assertEquals(503,assertThrows(RestClientResponseException::class.java) { http.classify("댓글") }.statusCode.value())
            mode.set(504)
            assertThrows(ResourceAccessException::class.java) { client(Duration.ofMillis(200)).classify("댓글") }
        } finally {
            server.stop(0)
        }
    }
}
