package ai.storyfork.content.work.client

import ai.storyfork.content.work.client.dto.WorkTagSuggestionInput
import ai.storyfork.content.work.client.dto.WorkTagSuggestionOutput
import java.net.SocketTimeoutException
import java.net.http.HttpTimeoutException
import org.springframework.http.converter.HttpMessageConversionException
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientException
import org.springframework.web.client.RestClientResponseException
import org.springframework.web.client.UnknownContentTypeException

class WorkTagSuggestionCallFailure(val code: String) : RuntimeException(code)

/** 장르·키워드 추천 네트워크 호출만 담당한다(#372). 재시도·DB 접근·결과 저장은 하지 않는다. */
class WorkTagSuggestionClient(private val client: RestClient, private val token: String) {
    fun suggest(input: WorkTagSuggestionInput): WorkTagSuggestionOutput {
        if (token.isBlank()) throw WorkTagSuggestionCallFailure("AI_NOT_CONFIGURED")
        try {
            return client.post().uri("/internal/v1/work-tags/suggestions")
                .header("X-Internal-Token", token).body(input).retrieve().body(WorkTagSuggestionOutput::class.java)
                ?: throw WorkTagSuggestionCallFailure("AI_OUTPUT_INVALID")
        } catch (e: RestClientResponseException) {
            throw WorkTagSuggestionCallFailure(when (e.statusCode.value()) {
                504 -> "AI_TIMEOUT"
                503 -> "AI_UNAVAILABLE"
                502 -> "AI_OUTPUT_INVALID"
                403, 422 -> "AI_REQUEST_REJECTED"
                else -> "AI_UNAVAILABLE"
            })
        } catch (e: RestClientException) {
            val causes = generateSequence<Throwable>(e) { it.cause }.toList()
            // 200인데 읽을 수 없는 본문은 서비스 중단이 아니라 사용할 수 없는 결과다.
            val unreadable = e is UnknownContentTypeException || causes.any { it is HttpMessageConversionException }
            val timeout = causes.any { it is SocketTimeoutException || it is HttpTimeoutException }
            throw WorkTagSuggestionCallFailure(if (unreadable) "AI_OUTPUT_INVALID" else if (timeout) "AI_TIMEOUT" else "AI_UNAVAILABLE")
        }
    }
}
