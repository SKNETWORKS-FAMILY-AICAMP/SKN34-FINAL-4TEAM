package ai.storyfork.content.proposal.client.dto

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty

/** TASK 09의 내부 Run DTO. grant는 전송 중에만 존재하며 원고·요청문은 포함하지 않는다. */
data class AiRunDispatchRequest(val runId: String,val threadRef: String,val grantRef: String,
    val operation: String,val targetRefs: List<AiRunSourceRef>,val budget: AiRunBudget,
    val workId: String,val forkId: String?,val basisEpisode: Int)
data class AiRunSourceRef(@param:JsonProperty("work_id") @get:JsonProperty("work_id") val workId: String,
    val kind: String,@param:JsonProperty("document_id") @get:JsonProperty("document_id") val documentId: String,val revision: String)
data class AiRunBudget(val modelCalls: Int,val inputTokens: Int = 48000,val outputTokens: Int = 12000,val timeoutMs: Int = 120000)
@JsonIgnoreProperties(ignoreUnknown=true)
data class AiRunRemoteResponse(val runId: String,val threadRef: String,val status: String,
    @param:JsonProperty("isMock") @get:JsonProperty("isMock") val isMock: Boolean?,val error: AiRunRemoteError? = null)
@JsonIgnoreProperties(ignoreUnknown=true)
data class AiRunRemoteError(val code: String)
data class AiRunGrantResponse(val runId: String,val threadRef: String,val scopeRef: String,val expiresAt: java.time.Instant)
