package ai.storyfork.content.preprocessing.client

import ai.storyfork.content.preprocessing.client.dto.PreprocessingAiRequest
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientException

/** AI가 작업을 받지 못했다. [code]는 로그용 분류이고 사용자에게는 보이지 않는다. */
class PreprocessingAiFailure(val code: String) : RuntimeException(code)

/** AI 서비스에 전처리 작업을 접수시키는 네트워크 호출만 담당한다(#343). 재시도·DB 접근은 하지 않는다. */
class PreprocessingAiClient(private val client: RestClient, private val token: String) {
    fun accept(request: PreprocessingAiRequest) {
        if (token.isBlank()) throw PreprocessingAiFailure("AI_NOT_CONFIGURED")
        val status = try {
            client.post().uri("/internal/v1/preprocessing/jobs").header("X-Internal-Token", token).body(request).retrieve().toBodilessEntity().statusCode
        } catch (e: RestClientException) {
            throw PreprocessingAiFailure(e.javaClass.simpleName) // 4xx·5xx 응답, 타임아웃, 연결 실패
        }
        // 리다이렉트 같은 2xx 밖 응답을 접수로 오해하면 작업이 queued로 영원히 남는다.
        if (!status.is2xxSuccessful) throw PreprocessingAiFailure("AI_UNEXPECTED_STATUS")
    }
}
