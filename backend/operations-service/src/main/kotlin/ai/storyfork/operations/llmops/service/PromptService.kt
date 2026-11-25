package ai.storyfork.operations.llmops.service

import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.instantOrNull
import ai.storyfork.operations._common.client.textOrNull
import ai.storyfork.operations._common.exception.CandidateRequiredException
import ai.storyfork.operations._common.exception.EvaluationRequiredException
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.llmops.service.dto.Evaluation
import ai.storyfork.operations.llmops.service.dto.Prompt
import ai.storyfork.operations.llmops.service.dto.PromptCreateRequest
import ai.storyfork.operations.llmops.service.dto.PromptEvaluation
import ai.storyfork.operations.llmops.service.dto.PromptListResponse
import ai.storyfork.operations.llmops.service.dto.PromptPromoteRequest
import ai.storyfork.operations.llmops.service.dto.PromptVersion
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import tools.jackson.databind.JsonNode

private const val LLM = "llm"
private const val PRODUCTION = "production"
private const val SEED = "seed"
private val CANDIDATE = Regex("""candidate-\d+""")
private const val NAME_MAX = 100

/**
 * The evaluation set each prompt is evaluated on (#787, 2026-11-24 user decision; the manuscript extraction pair is #824): only the sets built from that very call. A version of these prompts
 * becomes a candidate once its newest run on the set passed; every other prompt has no fitting set and becomes a candidate without an evaluation.
 */
private val EVALUATION_SETS = mapOf(
    "story_context.answer" to "qa.grounding",
    "character_simulation.act" to "simulation.act",
    "character_simulation.narrate" to "simulation.narrate",
    "decision_guard.judge" to "decision_guard.routing",  // #783: the real guard judgment on its routing set
    "manuscript_extraction.extract" to "extraction.extract",
)

/** Prompt versions live in Langfuse; this service reads them with their latest evaluation, registers candidates (behind the evaluation gate for a prompt with a set) and moves the production label to a candidate. */
@Service
class PromptService(
    private val permissions: AdminPermissionRepository,
    private val langfuse: LangfuseClient,
    private val evaluations: EvaluationService,
    private val activities: AdminActivityService,
    /** Models a version may choose (#806): the OpenAI models the AI service calls, `LLMOPS_MODELS` (comma separated) adds or removes one. */
    @Value("\${app.operations.llmops-models}") private val models: List<String>,
) {
    /**
     * Only the production and seed versions of each prompt (read by label, once when one version has both), so the reads do not grow with the version
     * history (#786); the candidates are counted from the labels the prompt list carries. Prompts are read in parallel: the AI service registers every
     * prompt of every LLM call (#705).
     */
    fun list(member: OperationsMember): PromptListResponse {
        permissions.requirePermission(member, LLM)
        val latest = evaluations.latestByVersion(sets = EVALUATION_SETS)
        return PromptListResponse(langfuse.prompts().parallelStream().map { meta ->
            val name = meta.path("name").asString()
            val listed = labels(meta)
            val production = if (PRODUCTION in listed) langfuse.prompt(name, PRODUCTION) else null
            val seed = if (SEED in listed && production?.let { SEED in labels(it) } != true) langfuse.prompt(name, SEED) else null
            prompt(meta, listOfNotNull(production, seed).sortedByDescending { it.path("version").asInt() }, latest)
        }.toList())
    }

    fun detail(member: OperationsMember, name: String): Prompt {
        permissions.requirePermission(member, LLM)
        val meta = langfuse.prompts(name).firstOrNull { it.path("name").asString() == name } ?: throw NoSuchElementException("Prompt not found.")
        val versions = meta.path("versions").values().map { it.asInt() }.sortedDescending().map { langfuse.prompt(name, it) }
        return prompt(meta, versions, evaluations.latestByVersion(sets = EVALUATION_SETS), withBody = true).copy(models = models)
    }

    /** A new version without any label: it only reaches production through [promote]. */
    fun create(member: OperationsMember, name: String, request: PromptCreateRequest): PromptVersion {
        permissions.requirePermission(member, LLM)
        require(name.isNotBlank() && name.length <= NAME_MAX) { "Invalid prompt name." }
        val type = request.type ?: "text"
        val content = request.prompt
        require(type == "text" || type == "chat") { "Unknown prompt type." }
        require(content != null && if (type == "text") content.isString && content.stringValue().isNotBlank() else content.isArray && content.size() > 0) { "Invalid prompt." }
        val body = mutableMapOf<String, Any?>("name" to name, "type" to type, "prompt" to content, "labels" to emptyList<String>())
        request.config?.takeUnless { it.isNull }?.let { config ->
            // The AI service calls the model named here (#705) through OpenAI: only a configured model (#806), not every Langfuse price definition.
            config.get("model")?.let { model ->
                require(model.isString && model.stringValue() in models) { "Unknown model." }
            }
            body["config"] = config
        }
        request.commitMessage?.trim()?.takeIf { it.isNotEmpty() }?.let { body["commitMessage"] = it }
        val created = langfuse.createPrompt(body)
        val version = version(created, null)
        activities.record(member, "PROMPT_CREATE", "PROMPT", name, "v${version.version}")
        return version
    }

    /**
     * Registers the version (a prompt body with its chosen model) as a production candidate (#705). Langfuse keeps a label on one version only, so the
     * label names the version (candidate-<version>) and several candidates can coexist. A prompt with an evaluation set needs the version's newest run
     * on it to have passed (#787); a version that already is a candidate stays one.
     */
    fun candidate(member: OperationsMember, name: String, request: PromptPromoteRequest): PromptVersion {
        permissions.requirePermission(member, LLM)
        require(request.version >= 1) { "Invalid version." }
        val current = langfuse.prompt(name, request.version)
        val labels = labels(current)
        val candidate = candidateLabel(request.version)
        val evaluation = evaluations.latest(name, request.version, EVALUATION_SETS[name])
        if (candidate !in labels) {
            if (name in EVALUATION_SETS && evaluation?.passed != true) throw EvaluationRequiredException()
            langfuse.setPromptLabels(name, request.version, listOf(candidate))  // Langfuse adds it and keeps the other labels
            activities.record(member, "PROMPT_CANDIDATE", "PROMPT", name, "v${request.version}")
        }
        return PromptVersion(request.version, (labels - candidate) + candidate, createdAt(current), evaluation?.summary(), model(current))
    }

    /** Moves the production label to the version. Only a candidate goes there; restoring an older version is no exception (register it as a candidate first). */
    fun promote(member: OperationsMember, name: String, request: PromptPromoteRequest): PromptVersion {
        permissions.requirePermission(member, LLM)
        require(request.version >= 1) { "Invalid version." }
        val current = langfuse.prompt(name, request.version)
        val labels = labels(current)
        if (PRODUCTION in labels) return version(current, evaluations.latest(name, request.version, EVALUATION_SETS[name]))
        if (candidateLabel(request.version) !in labels) throw CandidateRequiredException()
        val evaluation = evaluations.latest(name, request.version, EVALUATION_SETS[name])  // only for the answer, on the same set as the candidate gate
        // Langfuse adds the sent label and keeps it unique across versions, so production moves here and the version's other labels stay.
        // Only production is sent: re-sending labels read earlier could move back a label another request moved meanwhile.
        langfuse.setPromptLabels(name, request.version, listOf(PRODUCTION))
        activities.record(member, "PROMPT_PROMOTE", "PROMPT", name, "v${request.version}")
        return PromptVersion(request.version, labels + PRODUCTION, createdAt(current), evaluation?.summary(), model(current))
    }

    private fun prompt(meta: JsonNode, versions: List<JsonNode>, latest: Map<Pair<String, Int>, Evaluation>, withBody: Boolean = false): Prompt {
        val name = meta.path("name").asString()
        val read = versions.map { version(it, latest[name to it.path("version").asInt()], withBody) }
        val live = read.firstOrNull { PRODUCTION in it.labels }?.version
        return Prompt(name, read, labels(meta).count { CANDIDATE.matches(it) && it != live?.let(::candidateLabel) }, EVALUATION_SETS[name])
    }

    private fun version(node: JsonNode, evaluation: Evaluation?, withBody: Boolean = false) = PromptVersion(
        node.path("version").asInt(), labels(node), createdAt(node), evaluation?.summary(), model(node), node.get("prompt")?.takeIf { withBody },
        node.path("commitMessage").textOrNull()?.takeIf { withBody },
    )

    private fun candidateLabel(version: Int) = "candidate-$version"

    private fun model(node: JsonNode) = node.path("config").path("model").textOrNull()

    private fun labels(node: JsonNode) = node.path("labels").values().mapNotNull { it.textOrNull() }

    private fun createdAt(node: JsonNode) = node.path("createdAt").instantOrNull()

    private fun Evaluation.summary() = PromptEvaluation(runId, passed, createdAt)
}
