package ai.storyfork.operations.llmops.service

import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.instantOrNull
import ai.storyfork.operations._common.client.textOrNull
import ai.storyfork.operations._common.exception.CandidateRequiredException
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
import org.springframework.stereotype.Service
import tools.jackson.databind.JsonNode

private const val LLM = "llm"
private const val PRODUCTION = "production"
private const val NAME_MAX = 100

/** Prompt versions live in Langfuse; this service reads them with their latest evaluation and moves the production label behind the evaluation gate. */
@Service
class PromptService(
    private val permissions: AdminPermissionRepository,
    private val langfuse: LangfuseClient,
    private val evaluations: EvaluationService,
    private val activities: AdminActivityService,
) {
    /**
     * Prompts are read in parallel: the AI service registers every prompt of every LLM call (#705), and reading them one after another took seconds.
     * shortcut: still one Langfuse read per version (the prompt list has no per-version labels), so a very long version history makes it slow;
     * read only the production and seed versions then.
     */
    fun list(member: OperationsMember): PromptListResponse {
        permissions.requirePermission(member, LLM)
        val latest = evaluations.latestByVersion()
        return PromptListResponse(langfuse.prompts().parallelStream().map { prompt(it, latest) }.toList())
    }

    fun detail(member: OperationsMember, name: String): Prompt {
        permissions.requirePermission(member, LLM)
        val meta = langfuse.prompts(name).firstOrNull { it.path("name").asString() == name } ?: throw NoSuchElementException("Prompt not found.")
        return prompt(meta, evaluations.latestByVersion(), withBody = true)
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
            // The AI service calls the model named here (#705): only a model with a Langfuse definition, so every call has a price.
            config.get("model")?.let { model ->
                require(model.isString && model.stringValue() in langfuse.models().map { it.path("modelName").asString() }) { "Unknown model." }
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
     * label names the version (candidate-<version>) and several candidates can coexist. Evaluation is optional for now (2026-11-24 user decision).
     */
    fun candidate(member: OperationsMember, name: String, request: PromptPromoteRequest): PromptVersion {
        permissions.requirePermission(member, LLM)
        require(request.version >= 1) { "Invalid version." }
        val current = langfuse.prompt(name, request.version)
        val labels = labels(current)
        val candidate = candidateLabel(request.version)
        if (candidate !in labels) {
            langfuse.setPromptLabels(name, request.version, (labels - "latest") + candidate)
            activities.record(member, "PROMPT_CANDIDATE", "PROMPT", name, "v${request.version}")
        }
        return PromptVersion(request.version, (labels - candidate) + candidate, createdAt(current), evaluations.latest(name, request.version)?.summary(), model(current))
    }

    /** Moves the production label to the version. Only a candidate goes there; restoring an older version is no exception (register it as a candidate first). */
    fun promote(member: OperationsMember, name: String, request: PromptPromoteRequest): PromptVersion {
        permissions.requirePermission(member, LLM)
        require(request.version >= 1) { "Invalid version." }
        val current = langfuse.prompt(name, request.version)
        val labels = labels(current)
        if (PRODUCTION in labels) return version(current, evaluations.latest(name, request.version))
        if (candidateLabel(request.version) !in labels) throw CandidateRequiredException()
        val evaluation = evaluations.latest(name, request.version)  // only for the answer: the gate no longer reads evaluations
        // Langfuse manages "latest" itself and keeps labels unique across versions, so the version's other labels stay and production moves here.
        langfuse.setPromptLabels(name, request.version, (labels - "latest") + PRODUCTION)
        activities.record(member, "PROMPT_PROMOTE", "PROMPT", name, "v${request.version}")
        return PromptVersion(request.version, labels + PRODUCTION, createdAt(current), evaluation?.summary(), model(current))
    }

    private fun prompt(meta: JsonNode, latest: Map<Pair<String, Int>, Evaluation>, withBody: Boolean = false): Prompt {
        val name = meta.path("name").asString()
        val versions = meta.path("versions").values().map { it.asInt() }.sortedDescending()
            .map { version(langfuse.prompt(name, it), latest[name to it], withBody) }
        return Prompt(name, versions)
    }

    private fun version(node: JsonNode, evaluation: Evaluation?, withBody: Boolean = false) = PromptVersion(
        node.path("version").asInt(), labels(node), createdAt(node), evaluation?.summary(), model(node), node.get("prompt")?.takeIf { withBody },
    )

    private fun candidateLabel(version: Int) = "candidate-$version"

    private fun model(node: JsonNode) = node.path("config").path("model").textOrNull()

    private fun labels(node: JsonNode) = node.path("labels").values().mapNotNull { it.textOrNull() }

    private fun createdAt(node: JsonNode) = node.path("createdAt").instantOrNull()

    private fun Evaluation.summary() = PromptEvaluation(runId, passed, createdAt)
}
