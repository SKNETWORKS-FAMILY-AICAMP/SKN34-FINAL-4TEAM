package ai.storyfork.content.world.client

import ai.storyfork.content.world.client.dto.WorldReviewAiRequest
import ai.storyfork.content.world.service.InitialWorldInput
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientResponseException
import org.springframework.web.client.RestClientException
import java.net.SocketTimeoutException
import java.net.http.HttpTimeoutException

class InitialWorldCallFailure(val code:String,val uncertain:Boolean):RuntimeException(code)

/** 네트워크 호출만 담당한다. 재시도나 DB 접근은 하지 않는다. */
class InitialWorldExtractionClient(private val client:RestClient,private val token:String) {
    fun extract(input:InitialWorldInput):String=post("/internal/v1/initial-world/extractions",input)

    /** 설정집 AI 검토(docs/design/world-review-contract.md)도 같은 AI 서비스·토큰·시간 제한과 오류 변환을 쓴다. */
    fun review(input:WorldReviewAiRequest):String=post("/internal/v1/world-reviews",input)

    private fun post(uri:String,body:Any):String {
        if(token.isBlank()) throw InitialWorldCallFailure("AI_NOT_CONFIGURED",false)
        try {
            return client.post().uri(uri)
                .header("X-Internal-Token",token).body(body).retrieve().body(String::class.java)
                ?: throw InitialWorldCallFailure("AI_OUTPUT_INVALID",false)
        } catch(e:RestClientResponseException) {
            when(e.statusCode.value()) {
                504 -> throw InitialWorldCallFailure("AI_TIMEOUT",true)
                502 -> throw InitialWorldCallFailure("AI_OUTPUT_INVALID",false)
                403,422 -> throw InitialWorldCallFailure("AI_REQUEST_REJECTED",false)
                else -> throw InitialWorldCallFailure("AI_RESPONSE_UNCONFIRMED",true)
            }
        } catch(e:RestClientException) {
            val timeout=generateSequence<Throwable>(e) { it.cause }.any { it is SocketTimeoutException || it is HttpTimeoutException }
            throw InitialWorldCallFailure(if(timeout) "AI_TIMEOUT" else "AI_RESPONSE_UNCONFIRMED",true)
        }
    }
}
