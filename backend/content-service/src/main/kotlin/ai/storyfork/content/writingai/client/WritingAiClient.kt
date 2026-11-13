package ai.storyfork.content.writingai.client

import ai.storyfork.content._common.exception.ContentFailure
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientException
import org.springframework.web.client.RestClientResponseException
import tools.jackson.databind.JsonNode

/**
 * AI `POST /internal/v1/orchestrations` 호출. AI 오류는 사용자에게 보일 고정 문구로 바꾼다.
 * 작가의 Bearer는 `X-User-Authorization`으로 넘기며 AI는 승인된 초안 반영의 Content MCP 호출에만 쓴다(DEC-49).
 */
internal class WritingAiClient(private val http: RestClient, private val token: String) {
    fun orchestrate(body: Map<String, Any?>, authorization: String): JsonNode =
        try {
            http.post().uri("/internal/v1/orchestrations")
                .contentType(MediaType.APPLICATION_JSON).header("X-Internal-Token", token)
                .header("X-User-Authorization", authorization)
                .body(body).retrieve().body(JsonNode::class.java)
                ?: throw ContentFailure(502, "집필 AI 응답을 확인할 수 없어요.")
        } catch (error: RestClientResponseException) {
            when (error.statusCode.value()) {
                409 -> throw ContentFailure(409, "이 대화를 이어갈 수 없어요. 새 대화로 다시 요청해 주세요.")
                503 -> throw ContentFailure(503, "집필 AI를 사용할 수 없어요. 잠시 후 다시 시도해 주세요.")
                else -> throw ContentFailure(502, "집필 AI 요청을 처리하지 못했어요.")
            }
        } catch (_: RestClientException) {
            throw ContentFailure(503, "집필 AI에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.")
        }
}
