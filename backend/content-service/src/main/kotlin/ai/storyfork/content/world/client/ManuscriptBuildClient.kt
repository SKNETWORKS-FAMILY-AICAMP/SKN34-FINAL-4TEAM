package ai.storyfork.content.world.client

import ai.storyfork.content.world.service.ManuscriptBuildSource
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientException
import org.springframework.web.client.RestClientResponseException
import java.net.SocketTimeoutException
import java.net.http.HttpTimeoutException

/** 최초 구축 모델 호출. 자동 재시도·정본 접근 없이 Content가 결과를 보존한다. */
class ManuscriptBuildClient(private val client:RestClient,private val token:String) {
    fun extract(source:ManuscriptBuildSource)=post("extractions",mapOf("number" to source.number,"title" to source.title,"body" to source.body))
    fun structure(results:List<Map<String,Any?>>)=post("structure",mapOf("extractions" to results))
    private fun post(path:String,body:Any):String {
        if(token.isBlank()) throw InitialWorldCallFailure("AI_NOT_CONFIGURED",false)
        try {
            return client.post().uri("/internal/v1/manuscript-build/$path").header("X-Internal-Token",token)
                .body(body).retrieve().body(String::class.java) ?: throw InitialWorldCallFailure("AI_OUTPUT_INVALID",false)
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
