package ai.storyfork.content.proposal.service.dto

data class AiRunQuote(val quote: String,val episode: Int)
data class AiRunCoverageResponse(val expectedCount: Int,val verifiedCount: Int,val gaps: List<String>)
data class AiRunResultResponse(val status: String,val text: String,@get:com.fasterxml.jackson.annotation.JsonProperty("isMock") val isMock: Boolean,val citations: List<AiRunQuote>,val coverage: AiRunCoverageResponse?)

/** 자유 텍스트를 받지 않는 AI 내부 진행 입력. 문구는 Content의 고정 표에서만 만든다. */
data class AiRunProgressInput(val taskId: String,val attempt: Int,val phase: String,val step: Int,val code: String,val status: String)
data class AiRunEventResponse(val runId: String,val seq: Long,val taskId: String,val attempt: Int,val phase: String,
    val step: Int,val code: String,val status: String,val message: String)
data class AiRunEventsResponse(val runId: String,val events: List<AiRunEventResponse>,val lastEventId: Long,val status: String)
data class AiRunOutcome(val responseRef: String? = null,val proposalId: String? = null,
    val decisionId: String? = null,val applicationId: String? = null,
    @param:com.fasterxml.jackson.annotation.JsonProperty("isMock") @get:com.fasterxml.jackson.annotation.JsonProperty("isMock") val isMock: Boolean = false)
