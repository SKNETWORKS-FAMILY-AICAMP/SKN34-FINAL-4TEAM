package ai.storyfork.operations.llmops

import ai.storyfork.operations._common.client.AiClient
import ai.storyfork.operations._common.client.EvaluationStarted
import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.llmops.service.EvaluationService
import ai.storyfork.operations.llmops.service.dto.EvaluationRequest
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.JsonNode

/** Mocked Langfuse and AI clients: no network, Spring context or database. */
class EvaluationServiceTest {
    private val langfuse = mock(LangfuseClient::class.java)
    private val ai = mock(AiClient::class.java)
    private val activities = mock(AdminActivityService::class.java)
    private val operators = Operators()
    private val service = EvaluationService(operators.permissions, langfuse, ai, activities)
    private val now = Instant.parse("2026-11-19T10:00:00Z")

    /** A Dataset Run as the AI service starts it: the metadata values are strings. */
    private fun run(name: String, createdAt: String, metadata: String, dataset: String = "qa-regression") =
        json("""{"id":"id-$name","name":"$name","datasetName":"$dataset","createdAt":"$createdAt","metadata":$metadata}""")

    private fun started(prompt: String, version: Int) = """{"prompt":"$prompt","version":"$version","dataset":"qa-regression","tolerance":"0.02","baselineRun":"x","baselineVersion":"1"}"""

    /** A run-level score the AI service writes when it finishes. */
    private fun score(name: String, value: Double, dataType: String = "NUMERIC", metadata: String = "null") =
        json("""{"id":"s-$name","name":"$name","value":$value,"dataType":"$dataType","datasetRunId":"x","metadata":$metadata}""")

    private fun passedScore(passed: Boolean) = score("passed", if (passed) 1.0 else 0.0, "BOOLEAN", """{"failedItems":0,"totalItems":10}""")

    private val finished = run("run-1", "2026-11-19T01:00:00Z", started("qa/answer", 3))
    private val failedNewer = run("run-2", "2026-11-19T02:00:00Z", started("qa/answer", 3))
    private val running = run("run-3", "2026-11-19T09:30:00Z", started("qa/answer", 4))
    private val stale = run("run-5", "2026-11-19T07:00:00Z", started("world/review", 1), "world-regression")
    private val manual = run("run-4", "2026-11-19T09:50:00Z", """{"note":"started by hand in Langfuse"}""")

    private fun givenScores() {
        `when`(langfuse.runScores("id-run-1")).thenReturn(listOf(
            score("faithfulness", 0.9, metadata = """{"baseline":0.85,"delta":0.05,"tolerance":0.02}"""), score("context_precision", 0.8), passedScore(true),
        ))
        `when`(langfuse.runScores("id-run-2")).thenReturn(listOf(score("faithfulness", 0.5, metadata = """{"baseline":0.85}"""), passedScore(false)))
        `when`(langfuse.runScores("id-run-3")).thenReturn(emptyList())
        `when`(langfuse.runScores("id-run-5")).thenReturn(emptyList())
    }

    private fun givenRuns(vararg runs: JsonNode) {
        `when`(langfuse.datasetRuns()).thenReturn(runs.toList())
        givenScores()
    }

    private fun givenAllRuns() = givenRuns(finished, failedNewer, running, stale, manual)

    private fun scoredRuns() = mockingDetails(langfuse).invocations.filter { it.method.name == "runScores" }.map { it.arguments[0] }

    private fun assertForbidden(call: () -> Unit) {
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException::class.java) { call() }.statusCode)
    }

    @Test
    fun `only an operator with the llm permission reads or starts evaluations`() {
        for (denied in listOf(operators.jobs, operators.none, operators.stale)) {
            assertForbidden { service.list(denied) }
            assertForbidden { service.detail(denied, "run-1") }
            assertForbidden { service.start(denied, EvaluationRequest("d", "p", 1)) }
        }

        verifyNoInteractions(langfuse, ai, activities)
    }

    @Test
    fun `the list maps prompt runs newest first and skips runs that are not prompt evaluations`() {
        givenAllRuns()

        val items = service.list(operators.llm, now).items

        assertEquals(listOf("run-3", "run-5", "run-2", "run-1"), items.map { it.runId })
        assertEquals(listOf("qa-regression", "world-regression", "qa-regression", "qa-regression"), items.map { it.dataset })
        assertEquals(listOf("qa/answer", "world/review", "qa/answer", "qa/answer"), items.map { it.prompt })
        // The version is a string in the run metadata.
        assertEquals(listOf(4, 1, 3, 3), items.map { it.version })
        assertEquals(Instant.parse("2026-11-19T09:30:00Z"), items[0].createdAt)
        assertFalse(scoredRuns().contains("id-run-4"), "a run that is not a prompt evaluation is not scored")
    }

    @Test
    fun `the passed score decides completed and passed and a run without one is running until it is two hours old`() {
        givenAllRuns()

        val byRun = service.list(operators.llm, now).items.associateBy { it.runId }

        assertEquals(listOf("completed", true), listOf(byRun.getValue("run-1").status, byRun.getValue("run-1").passed))
        assertEquals(listOf("completed", false), listOf(byRun.getValue("run-2").status, byRun.getValue("run-2").passed))
        assertEquals("running", byRun.getValue("run-3").status)
        assertNull(byRun.getValue("run-3").passed)
        // Started at 07:00 and still no passed score at 10:00: an interrupted run shows as failed.
        assertEquals("failed", byRun.getValue("run-5").status)
        assertNull(byRun.getValue("run-5").passed)
    }

    @Test
    fun `a run is failed only when it is older than two hours`() {
        givenRuns(run("run-3", "2026-11-19T08:00:00Z", started("qa/answer", 4)))
        assertEquals("running", service.list(operators.llm, now).items.single().status)

        givenRuns(run("run-3", "2026-11-19T07:59:59Z", started("qa/answer", 4)))
        assertEquals("failed", service.list(operators.llm, now).items.single().status)

        // A run that finished late is completed, however old it is.
        givenRuns(run("run-1", "2026-11-18T00:00:00Z", started("qa/answer", 3)))
        assertEquals("completed", service.list(operators.llm, now).items.single().status)
    }

    @Test
    fun `each metric score carries its baseline and difference from the score metadata`() {
        givenAllRuns()

        val metrics = service.detail(operators.llm, "run-1", now).metrics

        assertEquals(listOf("faithfulness", "context_precision"), metrics.map { it.name })
        assertEquals(listOf(0.9, 0.8), metrics.map { it.score })
        assertEquals(0.85, metrics[0].baseline)
        assertEquals(0.05, checkNotNull(metrics[0].delta), 1e-9)
        assertNull(metrics[1].baseline)
        assertNull(metrics[1].delta)
    }

    @Test
    fun `a missing delta is computed from the baseline and the passed score is not a metric`() {
        givenAllRuns()

        val metrics = service.detail(operators.llm, "run-2", now).metrics

        assertEquals(listOf("faithfulness"), metrics.map { it.name })
        assertEquals(-0.35, checkNotNull(metrics[0].delta), 1e-9)
        assertTrue(service.detail(operators.llm, "run-3", now).metrics.isEmpty())
    }

    @Test
    fun `only numeric scores are metrics`() {
        givenRuns(finished)
        `when`(langfuse.runScores("id-run-1")).thenReturn(listOf(score("faithfulness", 0.9), score("verdict", 1.0, "CATEGORICAL"), score("geval", 0.7), passedScore(true)))

        assertEquals(listOf("faithfulness", "geval"), service.detail(operators.llm, "run-1", now).metrics.map { it.name })
    }

    @Test
    fun `a run is found by its name and scored alone and an unknown one is not found`() {
        givenAllRuns()

        assertEquals("run-2", service.detail(operators.llm, "run-2", now).runId)
        assertEquals(listOf<Any?>("id-run-2"), scoredRuns())
        assertThrows(NoSuchElementException::class.java) { service.detail(operators.llm, "run-4", now) } // not a prompt evaluation
        assertThrows(NoSuchElementException::class.java) { service.detail(operators.llm, "nope", now) }
    }

    @Test
    fun `the latest run per prompt version is the newest one and only those runs are scored`() {
        givenAllRuns()

        val latest = service.latestByVersion(now)

        assertEquals("run-2", latest.getValue("qa/answer" to 3).runId)
        assertEquals(false, latest.getValue("qa/answer" to 3).passed)
        assertEquals("run-3", latest.getValue("qa/answer" to 4).runId)
        assertEquals(setOf("qa/answer" to 3, "qa/answer" to 4, "world/review" to 1), latest.keys)
        assertEquals(setOf<Any?>("id-run-2", "id-run-3", "id-run-5"), scoredRuns().toSet())
    }

    @Test
    fun `one version's latest evaluation is scored alone`() {
        givenAllRuns()

        val latest = checkNotNull(service.latest("qa/answer", 3, now))

        assertEquals(listOf("run-2", false), listOf(latest.runId, latest.passed))
        assertEquals(listOf<Any?>("id-run-2"), scoredRuns())
        assertNull(service.latest("qa/answer", 9, now))
        assertNull(service.latest("other", 3, now))
    }

    @Test
    fun `at most the newest 50 runs are scored in the list`() {
        val many = (1..60).map { run("run-$it", Instant.parse("2026-11-19T00:00:00Z").plusSeconds(it.toLong()).toString(), started("qa/answer", it)) }
        `when`(langfuse.datasetRuns()).thenReturn(many)
        `when`(langfuse.runScores(anyString())).thenReturn(emptyList())

        assertEquals(50, service.list(operators.llm, now).items.size)
        assertEquals(50, scoredRuns().size)
    }

    @Test
    fun `starting hands the request to the AI service and records the run`() {
        `when`(ai.startEvaluation("qa-regression", "qa/answer", 3)).thenReturn(EvaluationStarted("qa-answer-v3-20261119"))

        val started = service.start(operators.llm, EvaluationRequest("qa-regression", "qa/answer", 3))

        assertEquals(listOf("qa-answer-v3-20261119", "qa-regression", "qa/answer", 3, "running"),
            listOf(started.runId, started.dataset, started.prompt, started.version, started.status))
        val order = inOrder(ai, activities)
        order.verify(ai).startEvaluation("qa-regression", "qa/answer", 3)
        order.verify(activities).record(operators.llm, "EVALUATION_RUN", "EVALUATION", "qa-answer-v3-20261119", "qa-regression · qa/answer v3")
    }

    @Test
    fun `an invalid request is 400 before the AI service and a failed start records nothing`() {
        for (bad in listOf(EvaluationRequest("", "p", 1), EvaluationRequest("d", " ", 1), EvaluationRequest("d", "p", 0), EvaluationRequest("d".repeat(201), "p", 1))) {
            assertThrows(IllegalArgumentException::class.java) { service.start(operators.llm, bad) }
        }
        verifyNoInteractions(ai, activities)

        `when`(ai.startEvaluation("d", "p", 1)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))
        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { service.start(operators.llm, EvaluationRequest("d", "p", 1)) }.statusCode)
        verifyNoInteractions(activities)
    }
}
