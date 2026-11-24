package ai.storyfork.operations.llmops.controller

import ai.storyfork.operations.llmops.service.*
import ai.storyfork.operations.llmops.service.dto.*
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import org.springframework.http.HttpStatus
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*

/** Member Bearer API (operator + llm permission, checked by each service before any input is read or Langfuse is called). */
@RestController
@RequestMapping("/api/v1/operations/llmops")
class LlmopsController(
    private val traces: TraceService,
    private val metrics: MetricsService,
    private val prompts: PromptService,
    private val models: ModelService,
    private val evaluations: EvaluationService,
    private val leakChecks: LeakCheckService,
    private val settings: LlmopsSettingService,
    private val pipelines: PipelineService,
) {
    @GetMapping("/traces")
    fun traces(
        @AuthenticationPrincipal member: OperationsMember, @RequestParam(required = false) from: Instant?, @RequestParam(required = false) to: Instant?,
        @RequestParam(required = false) feature: String?, @RequestParam(required = false) status: String?, @RequestParam(required = false) userId: String?,
        @RequestParam(required = false) requestId: String?, @RequestParam(defaultValue = "0") page: Int,
    ) = traces.list(member, from, to, feature, status, userId, requestId, page)

    @GetMapping("/traces/{id}")
    fun trace(@AuthenticationPrincipal member: OperationsMember, @PathVariable id: String) = traces.detail(member, id)

    @GetMapping("/pipeline")
    fun pipeline(@AuthenticationPrincipal member: OperationsMember, @RequestParam(required = false) from: Instant?, @RequestParam(required = false) to: Instant?) =
        pipelines.pipeline(member, from, to)

    @GetMapping("/pipeline/{nodeId}/records")
    fun pipelineRecords(
        @AuthenticationPrincipal member: OperationsMember, @PathVariable nodeId: String, @RequestParam(required = false) from: Instant?, @RequestParam(required = false) to: Instant?,
        @RequestParam(required = false) level: String?, @RequestParam(defaultValue = "0") page: Int,
    ) = pipelines.records(member, nodeId, from, to, level, page)

    @GetMapping("/metrics")
    fun metrics(
        @AuthenticationPrincipal member: OperationsMember, @RequestParam(required = false) from: Instant?, @RequestParam(required = false) to: Instant?,
        @RequestParam(required = false) groupBy: String?,
    ) = metrics.metrics(member, from, to, groupBy)

    @GetMapping("/prompts")
    fun prompts(@AuthenticationPrincipal member: OperationsMember) = prompts.list(member)

    @GetMapping("/prompts/{name}")
    fun prompt(@AuthenticationPrincipal member: OperationsMember, @PathVariable name: String) = prompts.detail(member, name)

    @PostMapping("/prompts/{name}")
    @ResponseStatus(HttpStatus.CREATED)
    fun createPrompt(@AuthenticationPrincipal member: OperationsMember, @PathVariable name: String, @RequestBody request: PromptCreateRequest) =
        prompts.create(member, name, request)

    @PutMapping("/prompts/{name}/candidate")
    fun candidate(@AuthenticationPrincipal member: OperationsMember, @PathVariable name: String, @RequestBody request: PromptPromoteRequest) =
        prompts.candidate(member, name, request)

    @PutMapping("/prompts/{name}/production")
    fun promote(@AuthenticationPrincipal member: OperationsMember, @PathVariable name: String, @RequestBody request: PromptPromoteRequest) =
        prompts.promote(member, name, request)

    @GetMapping("/models")
    fun models(@AuthenticationPrincipal member: OperationsMember) = models.list(member)

    @PostMapping("/models")
    @ResponseStatus(HttpStatus.CREATED)
    fun createModel(@AuthenticationPrincipal member: OperationsMember, @RequestBody request: ModelCreateRequest) = models.create(member, request)

    @GetMapping("/evaluations")
    fun evaluations(@AuthenticationPrincipal member: OperationsMember) = evaluations.list(member)

    @GetMapping("/evaluations/{runId}")
    fun evaluation(@AuthenticationPrincipal member: OperationsMember, @PathVariable runId: String) = evaluations.detail(member, runId)

    @PostMapping("/evaluations")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun startEvaluation(@AuthenticationPrincipal member: OperationsMember, @RequestBody request: EvaluationRequest) = evaluations.start(member, request)

    @GetMapping("/leak-checks")
    fun leakChecks(@AuthenticationPrincipal member: OperationsMember) = leakChecks.list(member)

    @GetMapping("/settings")
    fun settings(@AuthenticationPrincipal member: OperationsMember) = settings.get(member)

    @PutMapping("/settings")
    fun updateSettings(@AuthenticationPrincipal member: OperationsMember, @RequestBody request: LlmopsSettingsRequest) = settings.update(member, request)
}
