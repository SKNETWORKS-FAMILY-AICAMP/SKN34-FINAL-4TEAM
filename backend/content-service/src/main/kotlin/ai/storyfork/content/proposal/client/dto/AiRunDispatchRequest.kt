package ai.storyfork.content.proposal.client.dto

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty
import ai.storyfork.content.proposal.service.dto.AiRunProgressInput
import ai.storyfork.content.proposal.service.dto.AiRunOutcome

/** TASK 09의 내부 Run DTO. grant는 전송 중에만 존재하며 원고·요청문은 포함하지 않는다. */
data class AiRunDispatchRequest(val runId: String,val threadRef: String,val grantRef: String,
    val operation: String,val targetRefs: List<AiRunSourceRef>,val budget: AiRunBudget,
    val workId: String,val forkId: String?,val basisEpisode: Int,val prompt: String = "",
    val selection: ai.storyfork.content.proposal.service.dto.RunSelection? = null)
data class AiRunSourceRef(@param:JsonProperty("work_id") @get:JsonProperty("work_id") val workId: String,
    val kind: String,@param:JsonProperty("document_id") @get:JsonProperty("document_id") val documentId: String,val revision: String)
data class AiRunBudget(val modelCalls: Int,val inputTokens: Int = 48000,val outputTokens: Int = 12000,val timeoutMs: Int = 120000)
@JsonIgnoreProperties(ignoreUnknown=true)
data class AiRunRemoteResponse(val runId: String,val threadRef: String,val status: String,
    @param:JsonProperty("isMock") @get:JsonProperty("isMock") val isMock: Boolean?,val error: AiRunRemoteError? = null,
    val progress: List<AiRunProgressInput> = emptyList(),val outcome: AiRunOutcome? = null,
    val result: AiRunText? = null,val coverage: AiRunCoverage? = null)

@JsonIgnoreProperties(ignoreUnknown=true)
data class AiRunText(val status: String,val text: String,
    @param:JsonProperty("is_mock") val isMock: Boolean,val citations: List<AiRunCitation> = emptyList(),
    @param:JsonProperty("context_digest") val contextDigest: String? = null)
@JsonIgnoreProperties(ignoreUnknown=true)
data class AiRunCitation(val quote: String,val episode: Int,
    @param:JsonProperty("source_revision") val source: AiRunSourceRef,
    val span: List<Int>,@param:JsonProperty("source_hash") val sourceHash: String)
@JsonIgnoreProperties(ignoreUnknown=true)
data class AiRunCoverage(@param:JsonProperty("expected_count") val expectedCount: Int,
    @param:JsonProperty("verified_count") val verifiedCount: Int,
    @param:JsonProperty("critical_gaps") val criticalGaps: List<AiRunGap> = emptyList())
@JsonIgnoreProperties(ignoreUnknown=true)
data class AiRunGap(val code: String)
@JsonIgnoreProperties(ignoreUnknown=true)
data class AiRunRemoteError(val code: String)
data class AiRunGrantResponse(val runId: String,val threadRef: String,val scopeRef: String,val expiresAt: java.time.Instant,val cancelled: Boolean = false)

/** realtime 관계는 작가용 현재 상태이며 봉인된 판의 과거 관계가 아니다. */
data class AiRunRelation(val source: String,val target: String,val label: String,val body: String)
data class AiRunGraph(val worldId: java.util.UUID,val basisRevision: Int,val graphVersion: Long,
    val relations: List<AiRunRelation>)
data class AiRunRetrieval(val scopeRef: String,val digest: String,
    val context: ai.storyfork.content.context.service.dto.StoryContextResponse,val currentGraph: AiRunGraph?,
    val episodeDocuments: Map<Int,String>)
