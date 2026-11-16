package ai.storyfork.content.work

import ai.storyfork.content._common.helper.buildRestClient
import ai.storyfork.content.work.client.WorkTagSuggestionCallFailure
import ai.storyfork.content.work.client.WorkTagSuggestionClient
import ai.storyfork.content.work.client.dto.WorkTagEpisode
import ai.storyfork.content.work.client.dto.WorkTagSuggestionInput
import ai.storyfork.content.work.client.dto.WorkTagSuggestionOutput
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.URI
import java.time.Duration
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.web.client.RestClient

/** #372 추천 클라이언트의 경로·내부 토큰·실패 코드 변환을 loopback HTTP 대역으로 확인한다. */
class WorkTagSuggestionClientIntegrationTest {
    private val input = WorkTagSuggestionInput("work-tags.v1", "제목", "소개", listOf(WorkTagEpisode(1, "1화", "본문")), listOf("고전"), 2, 10)

    private fun <T> server(status: Int, body: String, run: (WorkTagSuggestionClient, MutableList<String>) -> T): T {
        val seen = mutableListOf<String>()
        val http = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        http.createContext("/") { exchange ->
            seen += "${exchange.requestMethod} ${exchange.requestURI.path} ${exchange.requestHeaders.getFirst("X-Internal-Token")}"
            val bytes = body.toByteArray()
            exchange.responseHeaders.add("Content-Type", "application/json")
            exchange.sendResponseHeaders(status, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        http.start()
        try {
            val rest = buildRestClient(RestClient.builder(), URI("http://127.0.0.1:${http.address.port}"), Duration.ofSeconds(1), Duration.ofSeconds(5))
            return run(WorkTagSuggestionClient(rest, "token"), seen)
        } finally { http.stop(0) }
    }

    @Test
    fun `내부 토큰으로 추천 경로를 부르고 후보를 읽는다`() {
        server(200, """{"schemaVersion":"work-tags.v1","genres":["고전"],"hashtags":["장돌뱅이"]}""") { client, seen ->
            assertEquals(WorkTagSuggestionOutput("work-tags.v1", listOf("고전"), listOf("장돌뱅이")), client.suggest(input))
            assertEquals(listOf("POST /internal/v1/work-tags/suggestions token"), seen)
        }
    }

    @Test
    fun `AI 서비스 상태 코드를 고정 실패 코드로 바꾼다`() {
        mapOf(504 to "AI_TIMEOUT", 503 to "AI_UNAVAILABLE", 502 to "AI_OUTPUT_INVALID", 422 to "AI_REQUEST_REJECTED", 403 to "AI_REQUEST_REJECTED", 500 to "AI_UNAVAILABLE")
            .forEach { (status, code) ->
                server(status, """{"detail":"x"}""") { client, _ ->
                    assertEquals(code, assertThrows(WorkTagSuggestionCallFailure::class.java) { client.suggest(input) }.code)
                }
            }
    }

    @Test
    fun `200인데 읽을 수 없는 본문은 서비스 중단이 아니라 사용할 수 없는 결과로 본다`() {
        server(200, "not json") { client, _ ->
            assertEquals("AI_OUTPUT_INVALID", assertThrows(WorkTagSuggestionCallFailure::class.java) { client.suggest(input) }.code)
        }
    }

    @Test
    fun `토큰이 없으면 호출하지 않는다`() {
        val failure = assertThrows(WorkTagSuggestionCallFailure::class.java) {
            WorkTagSuggestionClient(RestClient.create("http://127.0.0.1:9"), "").suggest(input)
        }
        assertEquals("AI_NOT_CONFIGURED", failure.code)
    }
}
