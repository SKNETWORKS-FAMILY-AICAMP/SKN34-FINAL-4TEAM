package ai.storyfork.operations.llmops

import ai.storyfork.operations._common.client.AiClient
import ai.storyfork.operations._common.client.EvaluationStarted
import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.llmops.service.EvaluationService
import ai.storyfork.operations.llmops.service.dto.EvaluationRequest
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.JsonNode

/** Mocked AI client and a fake Langfuse that answers like the Experiments and Scores v3 APIs: no network, Spring context or database. */
class EvaluationServiceTest {
    // The experiments Langfuse knows (its name filter is exact, like the real one) and the scores of each, found by experiment id.
    private var experiments: List<JsonNode> = emptyList()
    private val scores = mutableMapOf<String, List<JsonNode>>()
    private val langfuse = mock(LangfuseClient::class.java) { call ->
        when (call.method.name) {
            "experiments" -> experiments.filter { call.arguments[1] == null || it.path("name").asString() == call.arguments[1] }
            "experimentScores" -> (call.arguments[0] as List<*>).flatMap { scores[it].orEmpty() }
            else -> null
        }
    }
    private val ai = mock(AiClient::class.java)
    private val activities = mock(AdminActivityService::class.java)
    private val operators = Operators()
    private val service = EvaluationService(operators.permissions, langfuse, ai, activities)
    private val now = Instant.parse("2026-11-19T10:00:00Z")

    /** An experiment (Dataset Run) as the AI service starts it: named "<prompt>@v<version>-<UTC time>-<hex6>", metadata values are strings. */
    private fun experiment(prompt: String, version: Int, startTime: String, hex: String, dataset: String = "qa-regression"): JsonNode {
        val stamp = startTime.replace("-", "").replace(":", "")
        return json("""{"id":"id-$hex","name":"$prompt@v$version-$stamp-$hex","description":null,"startTime":"$startTime","endTime":"$startTime","itemCount":10,"datasetId":"ds-1",
            "metadata":{"prompt":"$prompt","version":"$version","dataset":"$dataset","tolerance":"0.02","baselineRun":"x","baselineVersion":"1"}}""")
    }

    private fun name(experiment: JsonNode) = experiment.path("name").asString()

    /** A run-level score as Scores API v3 answers it with the details and subject groups: BOOLEAN is true or false, NUMERIC a number. */
    private fun score(experimentId: String, name: String, value: Any, dataType: String = "NUMERIC", metadata: String = "null", kind: String = "experiment", id: String = experimentId) =
        json("""{"id":"s-$id-$name","projectId":"p","name":"$name","source":"API","timestamp":"2026-11-19T02:00:00Z","environment":"default","createdAt":"2026-11-19T02:00:00Z",
            "updatedAt":"2026-11-19T02:00:00Z","dataType":"$dataType","value":$value,"comment":null,"configId":null,"metadata":$metadata,"subject":{"kind":"$kind","id":"$id"}}""")

    private fun passed(experimentId: String, passed: Boolean) = score(experimentId, "passed", passed, "BOOLEAN", """{"failedItems":0,"totalItems":10}""")

    private val finished = experiment("qa/answer", 3, "2026-11-19T01:00:00Z", "a1b2c3")
    private val failedNewer = experiment("qa/answer", 3, "2026-11-19T02:00:00Z", "b2c3d4")
    private val running = experiment("qa/answer", 4, "2026-11-19T09:30:00Z", "c3d4e5")
    private val stale = experiment("world/review", 1, "2026-11-19T07:00:00Z", "d4e5f6", "world-regression")
    private val manual = json("""{"id":"id-manual","name":"tried by hand","description":null,"startTime":"2026-11-19T09:50:00Z","endTime":"2026-11-19T09:50:00Z","itemCount":2,"datasetId":null,
        "metadata":{"note":"started by hand in Langfuse"}}""")

    private fun givenAllRuns() {
        experiments = listOf(manual, running, stale, failedNewer, finished)
        scores["id-a1b2c3"] = listOf(score("id-a1b2c3", "faithfulness", 0.9, metadata = """{"baseline":0.85,"delta":0.05,"tolerance":0.02}"""), score("id-a1b2c3", "context_precision", 0.8), passed("id-a1b2c3", true))
        scores["id-b2c3d4"] = listOf(score("id-b2c3d4", "faithfulness", 0.5, metadata = """{"baseline":0.85}"""), passed("id-b2c3d4", false))
    }

    private fun scoreReads() = mockingDetails(langfuse).invocations.filter { it.method.name == "experimentScores" }.map { it.arguments[0] }

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
    fun `the list maps prompt runs newest first and skips experiments that are not prompt evaluations`() {
        givenAllRuns()

        val items = service.list(operators.llm, now).items

        assertEquals(listOf(running, stale, failedNewer, finished).map(::name), items.map { it.runId })
        assertEquals(listOf("qa-regression", "world-regression", "qa-regression", "qa-regression"), items.map { it.dataset })
        assertEquals(listOf("qa/answer", "world/review", "qa/answer", "qa/answer"), items.map { it.prompt })
        assertEquals(listOf(4, 1, 3, 3), items.map { it.version })
        assertEquals(Instant.parse("2026-11-19T09:30:00Z"), items[0].createdAt)
        // Langfuse is asked for a year of experiments (it requires a start time) and for no name in particular.
        val read = mockingDetails(langfuse).invocations.single { it.method.name == "experiments" }
        assertEquals(listOf<Any?>(now.minus(365, ChronoUnit.DAYS), null), read.arguments.toList())
        assertFalse(scoreReads().flatMap { it as List<*> }.contains("id-manual"), "an experiment that is not a prompt evaluation is not scored")
    }

    @Test
    fun `the passed score decides completed and passed and a run without one is running until it is two hours old`() {
        givenAllRuns()

        val byRun = service.list(operators.llm, now).items.associateBy { it.runId }

        assertEquals(listOf("completed", true), listOf(byRun.getValue(name(finished)).status, byRun.getValue(name(finished)).passed))
        assertEquals(listOf("completed", false), listOf(byRun.getValue(name(failedNewer)).status, byRun.getValue(name(failedNewer)).passed))
        assertEquals("running", byRun.getValue(name(running)).status)
        assertNull(byRun.getValue(name(running)).passed)
        // Started at 07:00 and still no passed score at 10:00: an interrupted run shows as failed.
        assertEquals("failed", byRun.getValue(name(stale)).status)
        assertNull(byRun.getValue(name(stale)).passed)
    }

    @Test
    fun `a run is failed only when it is older than two hours`() {
        experiments = listOf(experiment("qa/answer", 4, "2026-11-19T08:00:00Z", "c3d4e5"))
        assertEquals("running", service.list(operators.llm, now).items.single().status)

        experiments = listOf(experiment("qa/answer", 4, "2026-11-19T07:59:59Z", "c3d4e5"))
        assertEquals("failed", service.list(operators.llm, now).items.single().status)

        // A run that finished late is completed, however old it is.
        experiments = listOf(experiment("qa/answer", 3, "2026-11-18T00:00:00Z", "a1b2c3"))
        scores["id-a1b2c3"] = listOf(passed("id-a1b2c3", true))
        assertEquals("completed", service.list(operators.llm, now).items.single().status)
    }

    @Test
    fun `each metric score carries its baseline and difference from the score metadata`() {
        givenAllRuns()

        val metrics = service.detail(operators.llm, name(finished), now).metrics

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

        val metrics = service.detail(operators.llm, name(failedNewer), now).metrics

        assertEquals(listOf("faithfulness"), metrics.map { it.name })
        assertEquals(-0.35, checkNotNull(metrics[0].delta), 1e-9)
        assertTrue(service.detail(operators.llm, name(running), now).metrics.isEmpty())
    }

    @Test
    fun `only numeric scores are metrics`() {
        experiments = listOf(finished)
        scores["id-a1b2c3"] = listOf(score("id-a1b2c3", "faithfulness", 0.9), score("id-a1b2c3", "verdict", "\"good\"", "CATEGORICAL"), score("id-a1b2c3", "geval", 0.7), score("id-a1b2c3", "clean", true, "BOOLEAN"), passed("id-a1b2c3", true))

        assertEquals(listOf("faithfulness", "geval"), service.detail(operators.llm, name(finished), now).metrics.map { it.name })
    }

    @Test
    fun `the verdict is found by its name whatever its data type and is never a metric`() {
        experiments = listOf(finished)
        for ((value, expected) in listOf<Pair<Any, Boolean>>(true to true, false to false, 1.0 to true, 0.0 to false, 0.5 to false)) {
            scores["id-a1b2c3"] = listOf(score("id-a1b2c3", "faithfulness", 0.9), score("id-a1b2c3", "passed", value, if (value is Boolean) "BOOLEAN" else "NUMERIC"))

            val evaluation = service.detail(operators.llm, name(finished), now)

            assertEquals(listOf("completed", expected), listOf(evaluation.status, evaluation.passed), value.toString())
            assertEquals(listOf("faithfulness"), evaluation.metrics.map { it.name })
        }
    }

    @Test
    fun `only scores whose subject is the experiment count`() {
        givenAllRuns()
        scores["id-a1b2c3"] = scores.getValue("id-a1b2c3") + listOf(score("id-a1b2c3", "faithfulness", 0.1, kind = "trace"), score("id-a1b2c3", "passed", false, "BOOLEAN", kind = "observation"))
        scores["id-c3d4e5"] = listOf(passed("id-b2c3d4", false))

        val byRun = service.list(operators.llm, now).items.associateBy { it.runId }

        // The extra trace and observation scores are neither the verdict nor a metric, and a score of another experiment is not this run's.
        assertEquals(listOf("completed", true, listOf("faithfulness", "context_precision")), byRun.getValue(name(finished)).let { listOf(it.status, it.passed, it.metrics.map { m -> m.name }) })
        assertEquals("running", byRun.getValue(name(running)).status)
    }

    @Test
    fun `a run whose time cannot be read is a 502`() {
        experiments = listOf(json("""{"id":"id-x","name":"qa/answer@v3-20261119T010000Z-a1b2c3","startTime":"last Tuesday","metadata":{}}"""))

        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { service.list(operators.llm, now) }.statusCode)
    }

    @Test
    fun `a prompt run is told by its name and else by its metadata and its dataset falls back to the dataset id`() {
        val named = json("""{"id":"id-1","name":"qa@v2@v3-20261119T010000Z-a1b2c3","startTime":"2026-11-19T01:00:00Z","datasetId":"ds-9","metadata":null}""")
        val tagged = json("""{"id":"id-2","name":"retry 2","startTime":"2026-11-19T02:00:00Z","datasetId":null,"metadata":{"prompt":"world/review","version":"5","dataset":"world-regression"}}""")
        val neither = json("""{"id":"id-3","name":"qa@v3-today-a1b2c3","startTime":"2026-11-19T03:00:00Z","datasetId":"ds-1","metadata":{"prompt":"qa"}}""")
        val blank = json("""{"id":"id-4","name":"qa@vx-20261119T010000Z-a1b2c3","startTime":"2026-11-19T04:00:00Z","datasetId":null,"metadata":{"prompt":"qa","version":""}}""")
        experiments = listOf(blank, neither, tagged, named)

        val items = service.list(operators.llm, now).items

        // The version and prompt come from the name (the prompt may contain "@v" itself), the dataset from the metadata or else the experiment's dataset id.
        assertEquals(listOf("retry 2", "qa@v2@v3-20261119T010000Z-a1b2c3"), items.map { it.runId })
        assertEquals(listOf("world/review" to 5, "qa@v2" to 3), items.map { it.prompt to it.version })
        assertEquals(listOf("world-regression", "ds-9"), items.map { it.dataset })
    }

    @Test
    fun `a run is found by its name and scored alone and an unknown one is not found`() {
        givenAllRuns()

        assertEquals(name(failedNewer), service.detail(operators.llm, name(failedNewer), now).runId)
        assertEquals(listOf<Any?>(listOf("id-b2c3d4")), scoreReads())
        // Langfuse is asked for that name only, so a large number of runs does not slow it down.
        val read = mockingDetails(langfuse).invocations.single { it.method.name == "experiments" }
        assertEquals(name(failedNewer), read.arguments[1])
        assertThrows(NoSuchElementException::class.java) { service.detail(operators.llm, "tried by hand", now) } // not a prompt evaluation
        assertThrows(NoSuchElementException::class.java) { service.detail(operators.llm, "nope", now) }
    }

    @Test
    fun `the latest run per prompt version is the newest one and only those runs are scored in one read`() {
        givenAllRuns()

        val latest = service.latestByVersion(now)

        assertEquals(name(failedNewer), latest.getValue("qa/answer" to 3).runId)
        assertEquals(false, latest.getValue("qa/answer" to 3).passed)
        assertEquals(name(running), latest.getValue("qa/answer" to 4).runId)
        assertEquals(setOf("qa/answer" to 3, "qa/answer" to 4, "world/review" to 1), latest.keys)
        assertEquals(listOf<Any?>(listOf("id-c3d4e5", "id-d4e5f6", "id-b2c3d4")), scoreReads())
    }

    @Test
    fun `one version's latest evaluation is scored alone`() {
        givenAllRuns()

        val latest = checkNotNull(service.latest("qa/answer", 3, now))

        assertEquals(listOf(name(failedNewer), false), listOf(latest.runId, latest.passed))
        assertEquals(listOf<Any?>(listOf("id-b2c3d4")), scoreReads())
        assertNull(service.latest("qa/answer", 9, now))
        assertNull(service.latest("other", 3, now))
    }

    @Test
    fun `at most the newest 50 runs are listed and scored in one read`() {
        experiments = (1..60).map { experiment("qa/answer", it, Instant.parse("2026-11-19T00:00:00Z").plusSeconds(it.toLong()).toString(), "%06x".format(it)) }

        assertEquals(50, service.list(operators.llm, now).items.size)
        assertEquals(listOf(50), scoreReads().map { (it as List<*>).size })
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
    fun `a scheduled start needs no admin and records no admin activity`() {
        `when`(ai.startEvaluation("qa-regression", "qa/answer", 3)).thenReturn(EvaluationStarted("qa-answer-v3-20261119"))

        val started = service.startRun(EvaluationRequest("qa-regression", "qa/answer", 3))

        assertEquals(listOf("qa-answer-v3-20261119", "qa-regression", "qa/answer", 3, "running"),
            listOf(started.runId, started.dataset, started.prompt, started.version, started.status))
        verifyNoInteractions(activities)
    }

    @Test
    fun `a scheduled start validates like an admin start and a failed AI call reaches the scheduler`() {
        for (bad in listOf(EvaluationRequest("", "p", 1), EvaluationRequest("d", " ", 1), EvaluationRequest("d", "p", 0), EvaluationRequest("d".repeat(201), "p", 1))) {
            assertThrows(IllegalArgumentException::class.java) { service.startRun(bad) }
        }
        verifyNoInteractions(ai)

        `when`(ai.startEvaluation("d", "p", 1)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))
        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { service.startRun(EvaluationRequest("d", "p", 1)) }.statusCode)
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
