package ai.storyfork.content.proposal.client

import ai.storyfork.content.proposal.client.dto.*
import ai.storyfork.content._common.exception.*
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientException

class GenerationClient(private val client: RestClient, private val token: String) {
    fun generate(request: GenerationPayload) = checked(post("/internal/v1/proposals", request, GenerationResponse::class.java))

    /** 새 회차 원고(#62). */
    fun draft(request: WritingDraftPayload) = checked(post("/internal/v1/writing/drafts", request, GenerationResponse::class.java))

    /** 선택 구간 수정(#62). 반환 text는 선택 구간을 대신할 after 문장이다. */
    fun patch(request: WritingPatchPayload) = checked(post("/internal/v1/writing/patches", request, WritingPatchResponse::class.java)
        ?.let { GenerationResponse(it.after, it.model, it.providerResponseId, it.usage) })

    private fun <T : Any> post(uri: String, body: Any, type: Class<T>): T? {
        checkContent(token.isNotBlank(),503,"AI 내부 인증 설정이 필요해요.")
        try {
            return client.post().uri(uri).header("X-Internal-Token",token).body(body).retrieve().body(type)
        } catch(_: RestClientException) { throw ContentFailure(503,"AI 생성에 실패했어요. 원고는 변경되지 않았어요.") }
    }

    private fun checked(result: GenerationResponse?): GenerationResponse {
        checkContent(result!=null && result.text.isNotBlank() && result.model.isNotBlank(),503,"AI 응답을 확인할 수 없어요.")
        val usage=result!!.usage
        checkContent(usage==null || (usage.inputTokens>=0 && usage.outputTokens>=0),503,"AI 사용량 응답을 확인할 수 없어요.")
        return result
    }
}
