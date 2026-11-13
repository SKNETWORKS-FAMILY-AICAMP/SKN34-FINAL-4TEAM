package ai.storyfork.content.writingai.client

import ai.storyfork.content._common.exception.ContentFailure
import java.io.OutputStream
import java.net.URI
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientException
import org.springframework.web.client.RestClientResponseException
import org.springframework.web.util.UriBuilder
import tools.jackson.databind.JsonNode

/**
 * AI 오케스트레이션·대화 세션 내부 API 호출. AI 오류는 사용자에게 보일 고정 문구로 바꾼다.
 * 작가의 Bearer는 `X-User-Authorization`으로 넘기며 AI는 승인된 초안 반영의 Content MCP 호출에만 쓴다(DEC-49).
 */
internal class WritingAiClient(private val http: RestClient, private val token: String) {
    fun orchestrate(body: Map<String, Any?>, authorization: String): JsonNode = call {
        http.post().uri("/internal/v1/orchestrations")
            .contentType(MediaType.APPLICATION_JSON).header("X-Internal-Token", token)
            .header("X-User-Authorization", authorization)
            .body(body).retrieve().body(JsonNode::class.java)
            ?: throw ContentFailure(502, "집필 AI 응답을 확인할 수 없어요.")
    }

    fun sessions(scope: String): JsonNode = read { it.path("/internal/v1/conversations").queryParam("scope", scope).build() }

    fun history(thread: String, scope: String): JsonNode =
        read { it.path("/internal/v1/conversations/{thread}").queryParam("scope", scope).build(thread) }

    fun rename(thread: String, scope: String, title: String) {
        call {
            http.patch().uri("/internal/v1/conversations/{thread}", thread).contentType(MediaType.APPLICATION_JSON)
                .header("X-Internal-Token", token).body(mapOf("scope" to scope, "title" to title)).retrieve().toBodilessEntity()
        }
    }

    fun delete(thread: String, scope: String) =
        remove { it.path("/internal/v1/conversations/{thread}").queryParam("scope", scope).build(thread) }

    fun truncate(thread: String, scope: String, index: Int) =
        remove { it.path("/internal/v1/conversations/{thread}/turns/{index}").queryParam("scope", scope).build(thread, index) }

    /**
     * AI SSE를 받은 그대로 흘려 보낸다. 응답 헤더를 이미 보냈으므로 AI 오류·연결 실패는 `error` 이벤트 하나로 알린다.
     * 읽을 때마다 flush해야 화면이 진행을 순서대로 받는다.
     */
    fun stream(body: Map<String, Any?>, authorization: String, out: OutputStream) {
        val failed = try {
            http.post().uri("/internal/v1/orchestrations/stream")
                .contentType(MediaType.APPLICATION_JSON).accept(MediaType.TEXT_EVENT_STREAM)
                .header("X-Internal-Token", token).header("X-User-Authorization", authorization).body(body)
                .exchange { _, response ->
                    if (response.statusCode.isError) return@exchange message(response.statusCode.value())
                    response.body.use { input ->
                        val buffer = ByteArray(8192)
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            out.write(buffer, 0, read)
                            out.flush()
                        }
                    }
                    null
                }
        } catch (_: RestClientException) {
            CONNECT_FAILED
        }
        if (failed != null) {
            out.write("event: error\ndata: {\"message\":\"$failed\"}\n\n".toByteArray())
            out.flush()
        }
    }

    private fun read(uri: (UriBuilder) -> URI): JsonNode = call {
        http.get().uri(uri).header("X-Internal-Token", token).retrieve().body(JsonNode::class.java)
            ?: throw ContentFailure(502, "집필 AI 응답을 확인할 수 없어요.")
    }

    private fun remove(uri: (UriBuilder) -> URI) {
        call { http.delete().uri(uri).header("X-Internal-Token", token).retrieve().toBodilessEntity() }
    }

    private fun <T> call(request: () -> T): T =
        try {
            request()
        } catch (error: RestClientResponseException) {
            val status = error.statusCode.value()
            throw ContentFailure(if (status in setOf(404, 409, 503)) status else 502, message(status))
        } catch (_: RestClientException) {
            throw ContentFailure(503, CONNECT_FAILED)
        }

    private fun message(status: Int) = when (status) {
        404 -> "대화를 찾을 수 없어요."
        409 -> "이 대화는 지금 바꾸거나 이어갈 수 없어요. 진행 중인 작업을 마치거나 새 대화로 다시 요청해 주세요."
        503 -> "집필 AI를 사용할 수 없어요. 잠시 후 다시 시도해 주세요."
        else -> "집필 AI 요청을 처리하지 못했어요."
    }

    private companion object {
        const val CONNECT_FAILED = "집필 AI에 연결할 수 없어요. 잠시 후 다시 시도해 주세요."
    }
}
