package ai.storyfork.operations.llmops

import ai.storyfork.operations.llmops.controller.LlmopsController
import ai.storyfork.operations.llmops.service.*
import ai.storyfork.operations.llmops.service.dto.*
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

/** Spring context나 HTTP 서버 없이 인증 회원 전달과 서비스 인자를 확인한다. */
class LlmopsControllerTest {
    private val traces = mock(TraceService::class.java)
    private val metrics = mock(MetricsService::class.java)
    private val prompts = mock(PromptService::class.java)
    private val models = mock(ModelService::class.java)
    private val evaluations = mock(EvaluationService::class.java)
    private val leakChecks = mock(LeakCheckService::class.java)
    private val settings = mock(LlmopsSettingService::class.java)
    private val pipelines = mock(PipelineService::class.java)
    private val optimizations = mock(OptimizationService::class.java)
    private val controller = LlmopsController(traces, metrics, prompts, models, evaluations, leakChecks, settings, pipelines, optimizations)
    private val member = OperationsMember(UUID.randomUUID(), true)
    private val from = Instant.parse("2026-11-18T00:00:00Z")
    private val to = Instant.parse("2026-11-19T00:00:00Z")

    @Test
    fun `trace routes pass every filter including the request id`() {
        val page = TracePage(emptyList(), 2, 20, 0)
        val detail = TraceDetail("t-1", from, "qa", "failed", 1, 2, 3, 0.1, null, null, null, null, emptyList())
        `when`(traces.list(member, from, to, "qa", "failed", "user-1", "req-9", 2)).thenReturn(page)
        `when`(traces.detail(member, "t-1")).thenReturn(detail)

        assertSame(page, controller.traces(member, from, to, "qa", "failed", "user-1", "req-9", 2))
        assertSame(detail, controller.trace(member, "t-1"))
    }

    @Test
    fun `pipeline routes pass the window the node the level and the page`() {
        val pipeline = Pipeline(emptyList())
        val records = PipelineRecordPage(emptyList(), 1, 20, 0)
        `when`(pipelines.pipeline(member, from, to)).thenReturn(pipeline)
        `when`(pipelines.records(member, "guard", from, to, "ERROR", 1)).thenReturn(records)

        assertSame(pipeline, controller.pipeline(member, from, to))
        assertSame(records, controller.pipelineRecords(member, "guard", from, to, "ERROR", 1))
    }

    @Test
    fun `metrics prompts models evaluations leak checks and settings routes reach their services`() {
        val metricsResult = Metrics(emptyList(), null, null, null)
        val promptList = PromptListResponse(emptyList())
        val modelList = ModelListResponse(emptyList())
        val evaluationList = EvaluationListResponse(emptyList())
        val leakList = LeakCheckListResponse(emptyList())
        val setting = LlmopsSettings(0.1)
        `when`(metrics.metrics(member, from, to, "model")).thenReturn(metricsResult)
        `when`(prompts.list(member)).thenReturn(promptList)
        `when`(models.list(member)).thenReturn(modelList)
        `when`(evaluations.list(member)).thenReturn(evaluationList)
        `when`(leakChecks.list(member)).thenReturn(leakList)
        `when`(settings.get(member)).thenReturn(setting)

        assertSame(metricsResult, controller.metrics(member, from, to, "model"))
        assertSame(promptList, controller.prompts(member))
        assertSame(modelList, controller.models(member))
        assertSame(evaluationList, controller.evaluations(member))
        assertSame(leakList, controller.leakChecks(member))
        assertSame(setting, controller.settings(member))
    }

    @Test
    fun `the write routes pass the name the body and the member`() {
        val create = PromptCreateRequest(null, "text", null, null)
        val promote = PromptPromoteRequest(3)
        val model = ModelCreateRequest("m", "^m$", 1.0, 1.0)
        val evaluation = EvaluationRequest("d", "p", 1)
        val setting = LlmopsSettingsRequest(0.2)

        controller.createPrompt(member, "qa/answer", create)
        controller.promote(member, "qa/answer", promote)
        controller.createModel(member, model)
        controller.startEvaluation(member, evaluation)
        controller.updateSettings(member, setting)
        controller.prompt(member, "qa/answer")
        controller.evaluation(member, "run-1")

        verify(prompts).create(member, "qa/answer", create)
        verify(prompts).promote(member, "qa/answer", promote)
        verify(prompts).detail(member, "qa/answer")
        verify(models).create(member, model)
        verify(evaluations).start(member, evaluation)
        verify(evaluations).detail(member, "run-1")
        verify(settings).update(member, setting)
    }

    @Test
    fun `the optimization route passes the member the prompt name and the request`() {
        val request = OptimizationRequest(2, 300)
        val started = OptimizationStartedResponse(true, "character_simulation.act", 2, 300)
        `when`(optimizations.start(member, "character_simulation.act", request)).thenReturn(started)

        assertSame(started, controller.optimize(member, "character_simulation.act", request))
    }
}
