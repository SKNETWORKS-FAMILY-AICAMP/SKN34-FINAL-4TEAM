package ai.storyfork.content.proposal.client

import ai.storyfork.content.proposal.client.dto.*
import ai.storyfork.content._common.helper.executeHttpCall
import org.springframework.web.client.RestClient

enum class AiRunFailure { AI_RUN_UNCONFIGURED, AI_RUN_UNAVAILABLE, AI_RUN_TIMEOUT, AI_RUN_REFUSED,
    AI_RUN_GRANT_EXPIRED, AI_RUN_INVALID_RESPONSE, AI_RUN_EXECUTOR_UNAVAILABLE }
class AiRunDispatchException(val failure: AiRunFailure) : RuntimeException(failure.name)

/** 제한된 위임으로 TASK 09 내부 API를 호출한다. 재시도·redirect·원고 전문 전송은 없다. */
class AiRunClient(private val client: RestClient,private val token: String) {
    fun dispatch(request: AiRunDispatchRequest): AiRunRemoteResponse = call(request) {
        client.post().uri("/internal/v1/ai/runs").header("X-Internal-Token",token)
            .body(request).retrieve().body(AiRunRemoteResponse::class.java)
    }
    fun status(request: AiRunDispatchRequest): AiRunRemoteResponse = call(request) {
        client.get().uri("/internal/v1/ai/runs/{id}",request.runId).header("X-Internal-Token",token)
            .header("X-Grant-Ref",request.grantRef).header("X-Thread-Ref",request.threadRef)
            .retrieve().body(AiRunRemoteResponse::class.java)
    }
    fun cancel(request: AiRunDispatchRequest): AiRunRemoteResponse = call(request) {
        client.post().uri("/internal/v1/ai/runs/{id}/cancel",request.runId).header("X-Internal-Token",token)
            .header("X-Grant-Ref",request.grantRef).header("X-Thread-Ref",request.threadRef)
            .retrieve().body(AiRunRemoteResponse::class.java)
    }
    private fun call(request: AiRunDispatchRequest,block: () -> AiRunRemoteResponse?): AiRunRemoteResponse {
        if(token.length<32 || token.any {it=='\r' || it=='\n'}) throw AiRunDispatchException(AiRunFailure.AI_RUN_UNCONFIGURED)
        val response=executeHttpCall(
            onTimeout={AiRunDispatchException(AiRunFailure.AI_RUN_TIMEOUT)},
            onUnavailable={AiRunDispatchException(AiRunFailure.AI_RUN_UNAVAILABLE)},
            onUpstreamError={AiRunDispatchException(if(it.statusCode.value()==403) AiRunFailure.AI_RUN_REFUSED else AiRunFailure.AI_RUN_UNAVAILABLE)},
            onInvalidResponse={AiRunDispatchException(AiRunFailure.AI_RUN_INVALID_RESPONSE)},block=block)
        if(response==null || response.runId!=request.runId || response.threadRef!=request.threadRef || response.isMock!=false
            || response.status !in setOf("pending","running","failed","denied","cancelled","succeeded","partial","clarification","proposal","awaiting_approval")
            || response.progress.size>500 || response.outcome?.isMock==true || response.outcome?.let {o -> listOfNotNull(o.responseRef,o.proposalId,o.decisionId,o.applicationId)
                .any {!it.matches(Regex("[A-Za-z0-9][A-Za-z0-9:_-]{0,127}"))}}==true)
            throw AiRunDispatchException(AiRunFailure.AI_RUN_INVALID_RESPONSE)
        return response
    }
}
