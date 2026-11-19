package ai.storyfork.operations.llmops.service

import ai.storyfork.operations._common.client.AiClient
import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.doubleOrNull
import ai.storyfork.operations._common.client.instant
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
import java.time.Duration
import java.time.Instant
import org.springframework.stereotype.Service

private const val LLM = "llm"
private const val NAME_MAX = 200
private const val PASSED = "passed"

/** ponytail: only the newest 50 runs are scored per list call (one Langfuse scores read each), so older runs drop out of the list. */
private const val MAX_LISTED_RUNS = 50

/** The AI service writes the verdict when it finishes, so a run still without one this long after it started was cut short (a restart, lost scoring). */
private val STALE_AFTER = Duration.ofHours(2)

/** A Dataset Run that is a prompt evaluation: the AI service starts it with metadata prompt and version (strings). */
private class Run(val id: String, val name: String, val dataset: String, val prompt: String, val version: Int, val createdAt: Instant)

/**
 * Regression evaluations. The AI service runs them: it starts a Langfuse Dataset Run with the metadata (prompt, version, dataset, tolerance,
 * baselineRun, baselineVersion) and, when it finishes, writes run-level scores: a NUMERIC average per metric (metadata baseline, delta, tolerance)
 * and the verdict "passed" (BOOLEAN 1.0 or 0.0). A run with the passed score is completed; without one it is running, or failed once it is older
 * than two hours. Runs without a prompt and version are not evaluations.
 */
@Service
class EvaluationService(
    private val permissions: AdminPermissionRepository,
    private val langfuse: LangfuseClient,
    private val ai: AiClient,
    private val activities: AdminActivityService,
) {
    fun list(member: OperationsMember): EvaluationListResponse = list(member, Instant.now())

    internal fun list(member: OperationsMember, now: Instant): EvaluationListResponse {
        permissions.requirePermission(member, LLM)
        return EvaluationListResponse(runs().take(MAX_LISTED_RUNS).map { evaluation(it, now) })
    }

    fun detail(member: OperationsMember, runId: String): Evaluation = detail(member, runId, Instant.now())

    /** [runId] is the run name. ponytail: found by listing every run, so a very large number of runs makes it slow. */
    internal fun detail(member: OperationsMember, runId: String, now: Instant): Evaluation {
        permissions.requirePermission(member, LLM)
        return runs().firstOrNull { it.name == runId }?.let { evaluation(it, now) } ?: throw NoSuchElementException("Evaluation not found.")
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

    /** The newest run of each prompt version, for the prompt screens; only those runs are scored. */
    internal fun latestByVersion(now: Instant = Instant.now()): Map<Pair<String, Int>, Evaluation> =
        runs().distinctBy { it.prompt to it.version }.associate { (it.prompt to it.version) to evaluation(it, now) }

    /** The newest run of one prompt version (scored alone): the production gate reads its verdict. */
    internal fun latest(prompt: String, version: Int, now: Instant = Instant.now()): Evaluation? =
        runs().firstOrNull { it.prompt == prompt && it.version == version }?.let { evaluation(it, now) }

    /** Newest first. */
    private fun runs(): List<Run> = langfuse.datasetRuns().mapNotNull { node ->
        val metadata = node.path("metadata")
        val prompt = metadata.path("prompt").textOrNull() ?: return@mapNotNull null
        val version = metadata.path("version").doubleOrNull()?.toInt() ?: return@mapNotNull null
        Run(node.path("id").asString(), node.path("name").asString(), node.path("datasetName").asString(), prompt, version, node.path("createdAt").instant())
    }.sortedByDescending { it.createdAt }

    private fun evaluation(run: Run, now: Instant): Evaluation {
        val scores = langfuse.runScores(run.id)
        val passed = scores.firstOrNull { it.path("name").asString() == PASSED }?.let { it.path("value").doubleOrNull() == 1.0 }
        val status = when {
            passed != null -> "completed"
            Duration.between(run.createdAt, now) > STALE_AFTER -> "failed"
            else -> "running"
        }
        val metrics = scores.filter { it.path("name").asString() != PASSED && it.path("dataType").asString() == "NUMERIC" }.mapNotNull { score ->
            val value = score.path("value").doubleOrNull() ?: return@mapNotNull null
            val baseline = score.path("metadata").path("baseline").doubleOrNull()
            EvaluationMetric(score.path("name").asString(), value, baseline, score.path("metadata").path("delta").doubleOrNull() ?: baseline?.let { value - it })
        }
        return Evaluation(run.name, run.dataset, run.prompt, run.version, status, passed, run.createdAt, metrics)
    }
}
