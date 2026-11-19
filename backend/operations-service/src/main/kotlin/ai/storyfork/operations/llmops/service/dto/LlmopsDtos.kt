package ai.storyfork.operations.llmops.service.dto

import java.time.Instant
import java.util.UUID
import tools.jackson.databind.JsonNode

// Response shapes follow docs/design/operations-llmops-contract.md; an optional field the source has no value for is null.

data class TraceItem(
    val id: String, val timestamp: Instant, val feature: String, val status: String, val latencyMs: Long,
    val inputTokens: Long, val outputTokens: Long, val cost: Double, val userId: String?, val workId: String?,
)

data class TraceObservation(
    val id: String, val name: String, val type: String, val startTime: Instant?, val endTime: Instant?, val latencyMs: Long,
    val model: String?, val inputTokens: Long?, val outputTokens: Long?, val level: String, val statusMessage: String?,
    val promptName: String?, val promptVersion: Int?,
)

/** A [TraceItem] plus the request and answer bodies and the steps. */
data class TraceDetail(
    val id: String, val timestamp: Instant, val feature: String, val status: String, val latencyMs: Long,
    val inputTokens: Long, val outputTokens: Long, val cost: Double, val userId: String?, val workId: String?,
    val input: JsonNode?, val output: JsonNode?, val observations: List<TraceObservation>,
)

data class TracePage(val items: List<TraceItem>, val page: Int, val size: Int, val total: Long)

data class MetricRow(
    val key: String, val requests: Int, val failureRate: Double, val timeoutRate: Double, val p50LatencyMs: Long, val p95LatencyMs: Long,
    val inputTokens: Long, val outputTokens: Long, val costUser: Double, val costPlatform: Double,
)

/** The three rates are fractions 0..1, null when there is nothing to divide by (or, for the filter, no filter feature yet). */
data class Metrics(val rows: List<MetricRow>, val adoptionRate: Double?, val approvalRate: Double?, val filterRestoreRate: Double?)

data class PromptEvaluation(val runId: String, val passed: Boolean?, val createdAt: Instant)

/** [createdAt] is null when Langfuse's prompt payload carries none. */
data class PromptVersion(val version: Int, val labels: List<String>, val createdAt: Instant?, val evaluation: PromptEvaluation?)

data class Prompt(val name: String, val versions: List<PromptVersion>)

data class PromptListResponse(val items: List<Prompt>)

/** [prompt] is a string for a text prompt and a message array for a chat prompt; [type] defaults to text. */
data class PromptCreateRequest(val prompt: JsonNode?, val type: String? = null, val config: JsonNode? = null, val commitMessage: String? = null)

data class PromptPromoteRequest(val version: Int)

/** Prices are USD per token. */
data class ModelResponse(
    val id: String, val modelName: String, val matchPattern: String, val inputPrice: Double?, val outputPrice: Double?, val unit: String,
)

data class ModelListResponse(val items: List<ModelResponse>)

data class ModelCreateRequest(val modelName: String, val matchPattern: String, val inputPrice: Double? = null, val outputPrice: Double? = null)

data class EvaluationMetric(val name: String, val score: Double, val baseline: Double?, val delta: Double?)

/** [runId] is the Langfuse Dataset Run name; [status] is running, completed or failed. */
data class Evaluation(
    val runId: String, val dataset: String, val prompt: String, val version: Int, val status: String, val passed: Boolean?,
    val createdAt: Instant, val metrics: List<EvaluationMetric>,
)

data class EvaluationListResponse(val items: List<Evaluation>)

data class EvaluationRequest(val dataset: String, val prompt: String, val version: Int)

data class EvaluationStartedResponse(val runId: String, val dataset: String, val prompt: String, val version: Int, val status: String)

data class LeakCheck(
    val id: UUID, val traceId: String, val workId: String, val checkedAt: Instant, val matched: List<String>, val suspected: Boolean, val reason: String?,
)

data class LeakCheckListResponse(val items: List<LeakCheck>)

data class LlmopsSettings(val leakSampleRate: Double)

data class LlmopsSettingsRequest(val leakSampleRate: Double)
