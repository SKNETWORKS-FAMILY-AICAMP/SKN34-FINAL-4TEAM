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
import tools.jackson.databind.JsonNode

private const val LLM = "llm"
private const val NAME_MAX = 200
private const val PASSED = "passed"

/** ponytail: only the newest 50 runs are listed, so older runs drop out of the list (the production gate still sees the newest 500). */
private const val MAX_LISTED_RUNS = 50

/** The AI service writes the verdict when it finishes, so a run still without one this long after it started was cut short (a restart, lost scoring). */
private val STALE_AFTER = Duration.ofHours(2)

/** Langfuse needs a lower time bound to list experiments. ponytail: a prompt version whose last evaluation is older than this needs a new one to be promoted. */
private val EXPERIMENT_LOOKBACK = Duration.ofDays(365)

/** The AI service names a run "<prompt>@v<version>-<UTC time yyyymmddTHHMMSSZ>-<6 hex digits>"; the prompt may contain "@v" itself. */
private val RUN_NAME = Regex("""^(.+)@v(\d+)-\d{8}T\d{6}Z-[0-9a-f]{6}$""")

/** Scores API v3 gives a BOOLEAN score as true or false and a NUMERIC one as a number; 1 is a pass either way. */
private fun JsonNode.verdict(): Boolean? = if (isBoolean) asBoolean() else doubleOrNull()?.let { it == 1.0 }

/** An experiment that is a prompt evaluation: the AI service started it for one version of a prompt. [id] is what its scores are attached to. */
private class Run(val id: String, val name: String, val dataset: String, val prompt: String, val version: Int, val createdAt: Instant)

/**
 * Regression evaluations. The AI service runs them: it starts a Langfuse experiment (a Dataset Run) named after the prompt version, with the metadata
 * (prompt, version, dataset, tolerance, baselineRun, baselineVersion), and when it finishes writes run-level scores attached to the experiment: a NUMERIC average
 * per metric (metadata baseline, delta, tolerance) and the verdict "passed" (BOOLEAN). Scores API v3 gives each score its subject, the experiment it belongs to.
 * A run with the passed score is completed; without one it is running, or failed once it is older than two hours. Experiments that are not named like a
 * prompt evaluation and carry no prompt and version are not evaluations.
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
        return EvaluationListResponse(evaluations(runs(now, null).take(MAX_LISTED_RUNS), now))
    }

    fun detail(member: OperationsMember, runId: String): Evaluation = detail(member, runId, Instant.now())

    /** [runId] is the run name, which Langfuse filters by itself. */
    internal fun detail(member: OperationsMember, runId: String, now: Instant): Evaluation {
        permissions.requirePermission(member, LLM)
        return runs(now, runId).firstOrNull { it.name == runId }?.let { evaluations(listOf(it), now).single() } ?: throw NoSuchElementException("Evaluation not found.")
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

    /** The newest run of each prompt version, for the prompt screens; only those runs are scored (in one read). */
    internal fun latestByVersion(now: Instant = Instant.now()): Map<Pair<String, Int>, Evaluation> =
        evaluations(runs(now, null).distinctBy { it.prompt to it.version }, now).associateBy { it.prompt to it.version }

    /** The newest run of one prompt version (scored alone): the production gate reads its verdict. */
    internal fun latest(prompt: String, version: Int, now: Instant = Instant.now()): Evaluation? =
        runs(now, null).firstOrNull { it.prompt == prompt && it.version == version }?.let { evaluations(listOf(it), now).single() }

    /** Newest first. */
    private fun runs(now: Instant, name: String?): List<Run> = langfuse.experiments(now.minus(EXPERIMENT_LOOKBACK), name).mapNotNull { node ->
        val metadata = node.path("metadata")
        val named = RUN_NAME.matchEntire(node.path("name").asString())
        val prompt = named?.groupValues?.get(1) ?: metadata.path("prompt").textOrNull() ?: return@mapNotNull null
        val version = named?.groupValues?.get(2)?.toIntOrNull() ?: metadata.path("version").doubleOrNull()?.toInt() ?: return@mapNotNull null
        val dataset = metadata.path("dataset").textOrNull() ?: node.path("datasetId").textOrNull().orEmpty()
        Run(node.path("id").asString(), node.path("name").asString(), dataset, prompt, version, node.path("startTime").instant())
    }.sortedByDescending { it.createdAt }

    /** The runs with their evaluation, all scored by one Scores API read: a score belongs to the experiment its subject names. */
    private fun evaluations(runs: List<Run>, now: Instant): List<Evaluation> {
        val scores = langfuse.experimentScores(runs.map { it.id }).filter { it.path("subject").path("kind").asString() == "experiment" }
            .groupBy { it.path("subject").path("id").asString() }
        return runs.map { evaluation(it, scores[it.id].orEmpty(), now) }
    }

    private fun evaluation(run: Run, scores: List<JsonNode>, now: Instant): Evaluation {
        val passed = scores.firstOrNull { it.path("name").asString() == PASSED }?.path("value")?.verdict()
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
