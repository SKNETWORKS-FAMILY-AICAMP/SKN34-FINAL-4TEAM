package ai.storyfork.operations.llmops.service

import ai.storyfork.operations._common.client.AiClient
import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.doubleOrNull
import ai.storyfork.operations._common.client.textOrNull
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.llmops.service.dto.Evaluation
import ai.storyfork.operations.llmops.service.dto.EvaluationListResponse
import ai.storyfork.operations.llmops.service.dto.EvaluationMetric
import ai.storyfork.operations.llmops.service.dto.EvaluationRequest
import ai.storyfork.operations.llmops.service.dto.EvaluationStartedResponse
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import org.springframework.stereotype.Service
import tools.jackson.databind.JsonNode

private const val LLM = "llm"
private const val NAME_MAX = 200
private val STATUSES = setOf("running", "completed", "failed")

/**
 * Regression evaluations. The AI service runs them and writes the result into a Langfuse Dataset Run's metadata:
 * prompt, version, passed (the verdict, written when it finishes), optional status (running, completed or failed),
 * metrics (name to score) and optional baseline (name to the baseline version's score). Runs without a prompt and version are not evaluations.
 */
@Service
class EvaluationService(
    private val permissions: AdminPermissionRepository,
    private val langfuse: LangfuseClient,
    private val ai: AiClient,
    private val activities: AdminActivityService,
) {
    fun list(member: OperationsMember): EvaluationListResponse {
        permissions.requirePermission(member, LLM)
        return EvaluationListResponse(evaluations())
    }

    /** [runId] is the run name. ponytail: found by listing every run, so a very large number of runs makes it slow. */
    fun detail(member: OperationsMember, runId: String): Evaluation {
        permissions.requirePermission(member, LLM)
        return evaluations().firstOrNull { it.runId == runId } ?: throw NoSuchElementException("Evaluation not found.")
    }

    /** The AI service answers 202 and keeps running; the result shows up in the run list. */
    fun start(member: OperationsMember, request: EvaluationRequest): EvaluationStartedResponse {
        permissions.requirePermission(member, LLM)
        require(request.dataset.isNotBlank() && request.dataset.length <= NAME_MAX) { "Invalid dataset." }
        require(request.prompt.isNotBlank() && request.prompt.length <= NAME_MAX) { "Invalid prompt." }
        require(request.version >= 1) { "Invalid version." }
        val started = ai.startEvaluation(request.dataset, request.prompt, request.version)
        activities.record(member, "EVALUATION_RUN", "EVALUATION", started.runName.take(100), "${request.dataset} · ${request.prompt} v${request.version}")
        return EvaluationStartedResponse(started.runName, request.dataset, request.prompt, request.version, "running")
    }

    /** The newest run of each prompt version: the prompt screen shows it and the production gate reads it. */
    internal fun latestByVersion(): Map<Pair<String, Int>, Evaluation> =
        evaluations().groupBy { it.prompt to it.version }.mapValues { (_, runs) -> runs.maxBy { it.createdAt } }

    private fun evaluations(): List<Evaluation> = langfuse.datasetRuns().mapNotNull { it.toEvaluation() }.sortedByDescending { it.createdAt }

    private fun JsonNode.toEvaluation(): Evaluation? {
        val metadata = path("metadata")
        val prompt = metadata.path("prompt").textOrNull() ?: return null
        val version = metadata.path("version").doubleOrNull()?.toInt() ?: return null
        val passed = metadata.path("passed").takeIf { it.isBoolean }?.asBoolean()
        val status = metadata.path("status").textOrNull()?.takeIf { it in STATUSES } ?: if (passed != null) "completed" else "running"
        val scores = metadata.path("metrics")
        val baseline = metadata.path("baseline")
        val metrics = scores.propertyNames().mapNotNull { name ->
            scores.path(name).doubleOrNull()?.let { score ->
                val base = baseline.path(name).doubleOrNull()
                EvaluationMetric(name, score, base, base?.let { score - it })
            }
        }
        return Evaluation(path("name").asString(), path("datasetName").asString(), prompt, version, status, passed, Instant.parse(path("createdAt").asString()), metrics)
    }
}
