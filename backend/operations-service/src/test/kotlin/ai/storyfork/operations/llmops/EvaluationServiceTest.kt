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

/** Mocked Langfuse and AI clients: no network, Spring context or database. */
class EvaluationServiceTest {
    private val langfuse = mock(LangfuseClient::class.java)
    private val ai = mock(AiClient::class.java)
    private val activities = mock(AdminActivityService::class.java)
    private val operators = Operators()
    private val service = EvaluationService(operators.permissions, langfuse, ai, activities)

    private fun run(name: String, createdAt: String, metadata: String, dataset: String = "qa-regression") =
        json("""{"id":"id-$name","name":"$name","datasetName":"$dataset","createdAt":"$createdAt","metadata":$metadata}""")

    private val passed = run("run-1", "2026-11-19T01:00:00Z",
        """{"prompt":"qa/answer","version":3,"passed":true,"metrics":{"faithfulness":0.9,"relevancy":0.8},"baseline":{"faithfulness":0.85}}""")
    private val failedNewer = run("run-2", "2026-11-19T02:00:00Z", """{"prompt":"qa/answer","version":3,"passed":false,"metrics":{"faithfulness":0.5}}""")
    private val running = run("run-3", "2026-11-19T03:00:00Z", """{"prompt":"qa/answer","version":4}""")
    private val explicitlyFailed = run("run-5", "2026-11-19T00:30:00Z", """{"prompt":"world/review","version":1,"status":"failed"}""", "world-regression")
    private val manual = run("run-4", "2026-11-19T04:00:00Z", """{"note":"started by hand in Langfuse"}""")

    private fun givenRuns() = `when`(langfuse.datasetRuns()).thenReturn(listOf(passed, failedNewer, running, explicitlyFailed, manual))

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
        givenRuns()

        val items = service.list(operators.llm).items

        assertEquals(listOf("run-3", "run-2", "run-1", "run-5"), items.map { it.runId })
        assertEquals(listOf("qa-regression", "qa-regression", "qa-regression", "world-regression"), items.map { it.dataset })
        assertEquals(listOf("qa/answer", "qa/answer", "qa/answer", "world/review"), items.map { it.prompt })
        assertEquals(listOf(4, 3, 3, 1), items.map { it.version })
        assertEquals(Instant.parse("2026-11-19T03:00:00Z"), items[0].createdAt)
    }

    @Test
    fun `status follows the run metadata and a finished run without a stated status is completed`() {
        givenRuns()

        val byRun = service.list(operators.llm).items.associateBy { it.runId }

        assertEquals("running", byRun.getValue("run-3").status)
        assertNull(byRun.getValue("run-3").passed)
        assertEquals(listOf("completed", true), listOf(byRun.getValue("run-1").status, byRun.getValue("run-1").passed))
        assertEquals(listOf("completed", false), listOf(byRun.getValue("run-2").status, byRun.getValue("run-2").passed))
        assertEquals("failed", byRun.getValue("run-5").status)
        assertNull(byRun.getValue("run-5").passed)
    }

    @Test
    fun `each metric carries its baseline and the difference when the run recorded one`() {
        givenRuns()

        val metrics = service.detail(operators.llm, "run-1").metrics

        assertEquals(listOf("faithfulness", "relevancy"), metrics.map { it.name })
        assertEquals(0.9, metrics[0].score)
        assertEquals(0.85, metrics[0].baseline)
        assertEquals(0.05, checkNotNull(metrics[0].delta), 1e-9)
        assertEquals(0.8, metrics[1].score)
        assertNull(metrics[1].baseline)
        assertNull(metrics[1].delta)
        assertTrue(service.detail(operators.llm, "run-3").metrics.isEmpty())
    }

    @Test
    fun `a run is found by its name and an unknown one is not found`() {
        givenRuns()

        assertEquals("run-2", service.detail(operators.llm, "run-2").runId)
        assertThrows(NoSuchElementException::class.java) { service.detail(operators.llm, "run-4") } // not a prompt evaluation
        assertThrows(NoSuchElementException::class.java) { service.detail(operators.llm, "nope") }
    }

    @Test
    fun `the latest run per prompt version is the newest one`() {
        givenRuns()

        val latest = service.latestByVersion()

        assertEquals("run-2", latest.getValue("qa/answer" to 3).runId)
        assertEquals(false, latest.getValue("qa/answer" to 3).passed)
        assertEquals("run-3", latest.getValue("qa/answer" to 4).runId)
        assertEquals(setOf("qa/answer" to 3, "qa/answer" to 4, "world/review" to 1), latest.keys)
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
