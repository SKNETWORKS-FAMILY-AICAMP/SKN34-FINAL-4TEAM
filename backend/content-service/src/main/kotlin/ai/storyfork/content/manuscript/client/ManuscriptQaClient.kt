package ai.storyfork.content.manuscript.client

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.manuscript.client.dto.ManuscriptQaPayload
import ai.storyfork.content.manuscript.client.dto.ManuscriptQaResult
import ai.storyfork.content.manuscript.client.dto.QaExcerpt
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientException
import org.springframework.web.client.RestClientResponseException

internal class ManuscriptQaClient(private val http: RestClient, private val token: String) {
    fun answer(question: String, excerpts: List<QaExcerpt>): ManuscriptQaResult =
        try {
            http.post().uri("/internal/v1/manuscript/qa")
                .contentType(MediaType.APPLICATION_JSON).header("X-Internal-Token", token)
                .body(ManuscriptQaPayload(question, excerpts)).retrieve().body(ManuscriptQaResult::class.java)
                ?: throw ContentFailure(502, "Q&A 모델 응답을 확인할 수 없어요.")
        } catch (error: RestClientResponseException) {
            if (error.statusCode.value() == 502) throw ContentFailure(502, "Q&A 모델 응답을 확인할 수 없어요.")
            throw ContentFailure(503, "Q&A 모델에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.")
        } catch (_: RestClientException) {
            throw ContentFailure(503, "Q&A 모델에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.")
        }
}
