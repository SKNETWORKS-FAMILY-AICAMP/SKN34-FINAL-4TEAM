package ai.storyfork.content.preprocessing

import ai.storyfork.content._common.helper.buildRestClient
import ai.storyfork.content.preprocessing.client.PreprocessingAiClient
import ai.storyfork.content.preprocessing.client.PreprocessingAiFailure
import ai.storyfork.content.preprocessing.client.dto.PreprocessingAiRequest
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.URI
import java.time.Duration
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.web.client.RestClient

/** #343 전처리 접수 클라이언트의 경로·내부 토큰·본문·실패 코드 변환을 loopback HTTP 대역으로 확인한다. */
class PreprocessingAiClientIntegrationTest {
    private val request = PreprocessingAiRequest("job-1", "work-1", listOf(1, 2, 5))

    private fun <T> server(status: Int, location: String? = null, run: (PreprocessingAiClient, MutableList<String>) -> T): T {
        val seen = mutableListOf<String>()
        val http = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        http.createContext("/") { exchange ->
            seen += "${exchange.requestMethod} ${exchange.requestURI.path} ${exchange.requestHeaders.getFirst("X-Internal-Token")} ${String(exchange.requestBody.readAllBytes())}"
            if (location != null) exchange.responseHeaders.add("Location", location)
            exchange.sendResponseHeaders(status, -1)
            exchange.close()
        }
        http.start()
        try {
            val rest = buildRestClient(RestClient.builder(), URI("http://127.0.0.1:${http.address.port}"), Duration.ofSeconds(1), Duration.ofSeconds(5))
            return run(PreprocessingAiClient(rest, "token"), seen)
        } finally { http.stop(0) }
    }

    @Test
    fun `내부 토큰으로 접수 경로를 부르고 202를 받으면 끝난다`() {
        server(202) { client, seen ->
            client.accept(request)
            assertEquals(listOf("POST /internal/v1/preprocessing/jobs token {\"jobId\":\"job-1\",\"workId\":\"work-1\",\"episodes\":[1,2,5]}"), seen)
        }
    }

    @Test
    fun `2xx가 아닌 AI 서비스 응답은 접수 실패다`() {
        for (status in listOf(403, 422, 500, 503, 504)) {
            server(status) { client, _ -> assertThrows(PreprocessingAiFailure::class.java, { client.accept(request) }, "${status}") }
        }
    }

    @Test
    fun `2xx 밖의 리다이렉트를 접수로 오해하지 않는다`() {
        server(302, location = "http://127.0.0.1:9/elsewhere") { client, _ ->
            assertEquals("AI_UNEXPECTED_STATUS", assertThrows(PreprocessingAiFailure::class.java) { client.accept(request) }.code)
        }
    }

    @Test
    fun `토큰이 없으면 호출하지 않는다`() {
        val failure = assertThrows(PreprocessingAiFailure::class.java) {
            PreprocessingAiClient(RestClient.create("http://127.0.0.1:9"), "").accept(request)
        }
        assertEquals("AI_NOT_CONFIGURED", failure.code)
    }
}
