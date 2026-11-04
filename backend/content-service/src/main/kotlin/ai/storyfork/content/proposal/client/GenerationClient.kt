package ai.storyfork.content.proposal.client

import ai.storyfork.content.proposal.client.dto.*
import ai.storyfork.content._common.exception.*
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientException

class GenerationClient(private val client: RestClient, private val token: String) {
    fun generate(request: GenerationPayload): GenerationResponse {
        checkContent(token.isNotBlank(),503,"AI 내부 인증 설정이 필요해요.")
        try {
            val result = client.post().uri("/internal/v1/proposals").header("X-Internal-Token",token)
                .body(request).retrieve().body(GenerationResponse::class.java)
            checkContent(result!=null && result.text.isNotBlank() && result.model.isNotBlank(),503,"AI 응답을 확인할 수 없어요.")
            val usage=result!!.usage
            checkContent(usage==null || (usage.inputTokens>=0 && usage.outputTokens>=0),503,"AI 사용량 응답을 확인할 수 없어요.")
            return result
        } catch(_: RestClientException) { throw ContentFailure(503,"AI 생성에 실패했어요. 원고는 변경되지 않았어요.") }
    }
}
