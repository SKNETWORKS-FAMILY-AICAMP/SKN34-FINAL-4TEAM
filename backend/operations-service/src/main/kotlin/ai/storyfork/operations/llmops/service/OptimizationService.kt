package ai.storyfork.operations.llmops.service

import ai.storyfork.operations._common.client.AiClient
import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.textOrNull
import ai.storyfork.operations._common.exception.OptimizationRunningException
import ai.storyfork.operations._common.exception.OptimizationUnsupportedException
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.llmops.service.dto.OptimizationRequest
import ai.storyfork.operations.llmops.service.dto.OptimizationStartedResponse
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.web.server.ResponseStatusException

private const val LLM = "llm"

/** The prompts GEPA may improve (#823, 2026-11-24 user decision): the character simulation calls, whose gate sets the new version is evaluated on. */
private val OPTIMIZABLE = setOf("character_simulation.act", "character_simulation.narrate")
private const val DEFAULT_MAX_METRIC_CALLS = 150
private const val MAX_METRIC_CALLS = 500

/**
 * Automatic prompt improvement: this service only accepts the request (permission, supported prompt, existing text version, budget) and hands it to the AI service,
 * whose worker improves the prompt, saves a new unlabelled version and evaluates it. Registering that version as a candidate stays a human step behind the gate.
 */
@Service
class OptimizationService(
    private val permissions: AdminPermissionRepository,
    private val langfuse: LangfuseClient,
    private val ai: AiClient,
    private val activities: AdminActivityService,
) {
    fun start(member: OperationsMember, name: String, request: OptimizationRequest): OptimizationStartedResponse {
        permissions.requirePermission(member, LLM)
        if (name !in OPTIMIZABLE) throw OptimizationUnsupportedException()
        val maxMetricCalls = request.maxMetricCalls ?: DEFAULT_MAX_METRIC_CALLS
        require(request.version >= 1) { "Invalid version." }
        require(maxMetricCalls in 1..MAX_METRIC_CALLS) { "Invalid budget." }
        val base = langfuse.prompt(name, request.version)   // a version Langfuse does not have is a 404
        if ((base.path("type").textOrNull() ?: "text") != "text") throw OptimizationUnsupportedException()
        try {
            ai.startOptimization(name, request.version, maxMetricCalls)
        } catch (error: ResponseStatusException) {
            if (error.statusCode == HttpStatus.CONFLICT) throw OptimizationRunningException()
            throw error
        }
        activities.record(member, "PROMPT_OPTIMIZE", "PROMPT", name, "v${request.version} · $maxMetricCalls")
        return OptimizationStartedResponse(true, name, request.version, maxMetricCalls)
    }
}
