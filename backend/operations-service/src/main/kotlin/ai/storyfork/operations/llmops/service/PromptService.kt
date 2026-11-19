package ai.storyfork.operations.llmops.service

import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.instantOrNull
import ai.storyfork.operations._common.client.textOrNull
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
    /** ponytail: one Langfuse read per version (the prompt list has no per-version labels), so a very long version history makes it slow. */
    fun list(member: OperationsMember): PromptListResponse {
        permissions.requirePermission(member, LLM)
        val latest = evaluations.latestByVersion()
        return PromptListResponse(langfuse.prompts().map { prompt(it, latest) })
    }

    fun detail(member: OperationsMember, name: String): Prompt {
        permissions.requirePermission(member, LLM)
        val meta = langfuse.prompts(name).firstOrNull { it.path("name").asString() == name } ?: throw NoSuchElementException("Prompt not found.")
        return prompt(meta, evaluations.latestByVersion())
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
        request.config?.takeUnless { it.isNull }?.let { body["config"] = it }
        request.commitMessage?.trim()?.takeIf { it.isNotEmpty() }?.let { body["commitMessage"] = it }
        val created = langfuse.createPrompt(body)
        val version = version(created, null)
        activities.record(member, "PROMPT_CREATE", "PROMPT", name, "v${version.version}")
        return version
    }

    /** Moves the production label to the version. It needs that version's latest evaluation to have passed; restoring an older version is no exception. */
    fun promote(member: OperationsMember, name: String, request: PromptPromoteRequest): PromptVersion {
        permissions.requirePermission(member, LLM)
        require(request.version >= 1) { "Invalid version." }
        val current = langfuse.prompt(name, request.version)
        val labels = labels(current)
        val evaluation = evaluations.latest(name, request.version)
        if (PRODUCTION in labels) return version(current, evaluation)
        if (evaluation?.passed != true) throw EvaluationRequiredException()
        // Langfuse manages "latest" itself and keeps labels unique across versions, so the version's other labels stay and production moves here.
        langfuse.setPromptLabels(name, request.version, (labels - "latest") + PRODUCTION)
        activities.record(member, "PROMPT_PROMOTE", "PROMPT", name, "v${request.version}")
        return PromptVersion(request.version, labels + PRODUCTION, createdAt(current), evaluation.summary())
    }

    private fun prompt(meta: JsonNode, latest: Map<Pair<String, Int>, Evaluation>): Prompt {
        val name = meta.path("name").asString()
        val versions = meta.path("versions").values().map { it.asInt() }.sortedDescending().map { version(langfuse.prompt(name, it), latest[name to it]) }
        return Prompt(name, versions)
    }

    private fun version(node: JsonNode, evaluation: Evaluation?) = PromptVersion(node.path("version").asInt(), labels(node), createdAt(node), evaluation?.summary())

    private fun labels(node: JsonNode) = node.path("labels").values().mapNotNull { it.textOrNull() }

    private fun createdAt(node: JsonNode) = node.path("createdAt").instantOrNull()

    private fun Evaluation.summary() = PromptEvaluation(runId, passed, createdAt)
}
