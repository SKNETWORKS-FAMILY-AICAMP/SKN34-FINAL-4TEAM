package ai.storyfork.content.proposal.service.dto

data class AiRunErrorResponse(val code: String, val retryable: Boolean = false)

data class AiRunResponse(val runId: String, val threadId: String, val workId: String,
    val status: String, val dispatchStatus: String, val error: AiRunErrorResponse? = null,
    val lastEventId: Long = 0,val result: AiRunOutcome? = null) {
    val statusUrl: String get() = "/api/v1/works/$workId/ai/runs/$runId"
    val eventsUrl: String get() = "$statusUrl/events"
}

data class AiThreadResponse(val threadId: String, val workId: String, val forkId: String?,
    val runs: List<AiRunResponse>, val nextCursor: Int?)
