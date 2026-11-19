package ai.storyfork.operations.llmops

import ai.storyfork.operations._common.client.AiClient
import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.exception.EvaluationRequiredException
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.llmops.service.EvaluationService
import ai.storyfork.operations.llmops.service.PromptService
import ai.storyfork.operations.llmops.service.dto.PromptCreateRequest
import ai.storyfork.operations.llmops.service.dto.PromptPromoteRequest
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.JsonNode

/** Mocked Langfuse client (real evaluation reading over it): no network, Spring context or database. */
class PromptServiceTest {
    // The experiments (Dataset Runs) Langfuse lists and the run-level scores of each; every other call answers with the Mockito default or its stub.
    private var experiments: List<JsonNode> = emptyList()
    private val scores = mutableMapOf<String, List<JsonNode>>()
    private val langfuse = mock(LangfuseClient::class.java, withSettings().defaultAnswer { call ->
        when (call.method.name) {
            "experiments" -> experiments
            "experimentScores" -> (call.arguments[0] as List<*>).flatMap { scores[it].orEmpty() }
            else -> RETURNS_DEFAULTS.answer(call)
        }
    })
    private val activities = mock(AdminActivityService::class.java)
    private val operators = Operators()
    private val evaluations = EvaluationService(operators.permissions, langfuse, mock(AiClient::class.java), mock(AdminActivityService::class.java))
    private val service = PromptService(operators.permissions, langfuse, evaluations, activities)

    /** An experiment as Langfuse lists it for a prompt evaluation: the metadata values are strings and name the prompt version (the name is free here). */
    private fun run(name: String, createdAt: String, prompt: String, version: Int) = json(
        """{"id":"id-$name","name":"$name","description":null,"startTime":"$createdAt","endTime":"$createdAt","itemCount":10,"datasetId":"ds-1",
            "metadata":{"prompt":"$prompt","version":"$version","dataset":"qa-regression"}}""")

    private fun version(name: String, version: Int, labels: String, createdAt: String? = null) = json(
        """{"name":"$name","version":$version,"labels":$labels${createdAt?.let { ",\"createdAt\":\"$it\"" } ?: ""}}""")

    /** Runs with their verdict: true or false is the run-level passed score, null is a run that has none yet. */
    private fun givenRuns(vararg runs: Pair<JsonNode, Boolean?>) {
        experiments = runs.map { it.first }
        scores.clear()
        for ((run, verdict) in runs) {
            val id = run.path("id").asString()
            scores[id] = listOfNotNull(verdict?.let { json("""{"id":"s","name":"passed","dataType":"BOOLEAN","value":$it,"metadata":null,"subject":{"kind":"experiment","id":"$id"}}""") })
        }
    }

    private fun assertForbidden(call: () -> Unit) {
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException::class.java) { call() }.statusCode)
    }

    @Test
    fun `only an operator with the llm permission reads or changes prompts`() {
        for (denied in listOf(operators.jobs, operators.none, operators.stale)) {
            assertForbidden { service.list(denied) }
            assertForbidden { service.detail(denied, "qa/answer") }
            assertForbidden { service.create(denied, "qa/answer", PromptCreateRequest(json("\"x\""))) }
            assertForbidden { service.promote(denied, "qa/answer", PromptPromoteRequest(1)) }
        }

        verifyNoInteractions(langfuse, activities)
    }

    @Test
    fun `a prompt lists its versions newest first with labels creation time and the latest evaluation`() {
        givenRuns(run("run-old", "2026-11-19T01:00:00Z", "qa/answer", 2) to false, run("run-new", "2026-11-19T02:00:00Z", "qa/answer", 2) to true)
        `when`(langfuse.prompts()).thenReturn(listOf(json("""{"name":"qa/answer","versions":[1,3,2],"labels":["production","latest"]}""")))
        `when`(langfuse.prompt("qa/answer", 1)).thenReturn(version("qa/answer", 1, "[]", "2026-11-01T00:00:00Z"))
        `when`(langfuse.prompt("qa/answer", 2)).thenReturn(version("qa/answer", 2, """["production"]""", "2026-11-10T00:00:00Z"))
        `when`(langfuse.prompt("qa/answer", 3)).thenReturn(version("qa/answer", 3, """["latest"]"""))

        val prompt = service.list(operators.llm).items.single()

        assertEquals("qa/answer", prompt.name)
        assertEquals(listOf(3, 2, 1), prompt.versions.map { it.version })
        assertEquals(listOf(listOf("latest"), listOf("production"), emptyList()), prompt.versions.map { it.labels })
        assertEquals(listOf(null, Instant.parse("2026-11-10T00:00:00Z"), Instant.parse("2026-11-01T00:00:00Z")), prompt.versions.map { it.createdAt })
        assertNull(prompt.versions[0].evaluation)
        assertNull(prompt.versions[2].evaluation)
        val evaluation = checkNotNull(prompt.versions[1].evaluation)
        assertEquals(listOf("run-new", true, Instant.parse("2026-11-19T02:00:00Z")), listOf(evaluation.runId, evaluation.passed, evaluation.createdAt))
    }

    @Test
    fun `a prompt version whose creation time cannot be read is a 502`() {
        givenRuns()
        `when`(langfuse.prompts()).thenReturn(listOf(json("""{"name":"qa/answer","versions":[1]}""")))
        `when`(langfuse.prompt("qa/answer", 1)).thenReturn(version("qa/answer", 1, "[]", "never"))

        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { service.list(operators.llm) }.statusCode)
    }

    @Test
    fun `the detail is the prompt with exactly that name and an unknown name is not found`() {
        givenRuns()
        `when`(langfuse.prompts("qa")).thenReturn(listOf(json("""{"name":"qa/answer","versions":[1]}"""), json("""{"name":"qa","versions":[1]}""")))
        `when`(langfuse.prompt("qa", 1)).thenReturn(version("qa", 1, """["production"]"""))
        `when`(langfuse.prompts("nope")).thenReturn(emptyList())

        assertEquals(listOf("qa"), listOf(service.detail(operators.llm, "qa").name))
        assertThrows(NoSuchElementException::class.java) { service.detail(operators.llm, "nope") }
    }

    @Test
    fun `a new version is registered without labels and recorded`() {
        `when`(langfuse.createPrompt(mapOf("name" to "qa/answer", "type" to "text", "prompt" to json("\"새 프롬프트\""),
            "labels" to emptyList<String>(), "commitMessage" to "문구 정리"))).thenReturn(version("qa/answer", 4, "[\"latest\"]", "2026-11-19T05:00:00Z"))

        val created = service.create(operators.llm, "qa/answer", PromptCreateRequest(json("\"새 프롬프트\""), null, null, "문구 정리"))

        assertEquals(listOf(4, listOf("latest"), Instant.parse("2026-11-19T05:00:00Z")), listOf(created.version, created.labels, created.createdAt))
        assertNull(created.evaluation)
        verify(activities).record(operators.llm, "PROMPT_CREATE", "PROMPT", "qa/answer", "v4")
    }

    @Test
    fun `a chat prompt and its config are passed through and an empty commit message is left out`() {
        val messages = json("""[{"role":"system","content":"규칙"}]""")
        val config = json("""{"temperature":0.2}""")
        `when`(langfuse.createPrompt(mapOf("name" to "chat/p", "type" to "chat", "prompt" to messages, "labels" to emptyList<String>(), "config" to config)))
            .thenReturn(version("chat/p", 1, "[\"latest\"]"))

        assertEquals(1, service.create(operators.llm, "chat/p", PromptCreateRequest(messages, "chat", config, "  ")).version)
    }

    @Test
    fun `an invalid prompt is 400 before Langfuse is written`() {
        val bad = listOf(
            "" to PromptCreateRequest(json("\"x\"")), "n".repeat(101) to PromptCreateRequest(json("\"x\"")),
            "p" to PromptCreateRequest(null), "p" to PromptCreateRequest(json("null")), "p" to PromptCreateRequest(json("\"   \"")),
            "p" to PromptCreateRequest(json("[]"), "chat"), "p" to PromptCreateRequest(json("\"x\""), "chat"), "p" to PromptCreateRequest(json("[1]")),
            "p" to PromptCreateRequest(json("\"x\""), "image"),
        )
        for ((name, request) in bad) assertThrows(IllegalArgumentException::class.java) { service.create(operators.llm, name, request) }

        assertTrue(mockingDetails(langfuse).invocations.isEmpty())
        verifyNoInteractions(activities)
    }

    @Test
    fun `promoting needs a passing evaluation of that very version and moves the production label`() {
        givenRuns(run("run-1", "2026-11-19T01:00:00Z", "qa/answer", 3) to true)
        `when`(langfuse.prompt("qa/answer", 3)).thenReturn(version("qa/answer", 3, """["latest","staging"]""", "2026-11-12T00:00:00Z"))

        val promoted = service.promote(operators.llm, "qa/answer", PromptPromoteRequest(3))

        assertEquals(listOf(3, listOf("latest", "staging", "production")), listOf(promoted.version, promoted.labels))
        assertEquals("run-1", promoted.evaluation?.runId)
        val order = inOrder(langfuse, activities)
        // Langfuse manages "latest" itself; every other label the version already had is kept.
        order.verify(langfuse).setPromptLabels("qa/answer", 3, listOf("staging", "production"))
        order.verify(activities).record(operators.llm, "PROMPT_PROMOTE", "PROMPT", "qa/answer", "v3")
    }

    @Test
    fun `without a passing latest evaluation promoting is a conflict with nothing changed`() {
        val labels = version("qa/answer", 3, """["latest"]""")
        `when`(langfuse.prompt("qa/answer", 3)).thenReturn(labels)
        val none = emptyList<Pair<tools.jackson.databind.JsonNode, Boolean?>>()
        val cases = mapOf(
            "no run at all" to none,
            "a failed latest run" to listOf(run("run-1", "2026-11-19T01:00:00Z", "qa/answer", 3) to true, run("run-2", "2026-11-19T02:00:00Z", "qa/answer", 3) to false),
            "a run of another version" to listOf(run("run-3", "2026-11-19T01:00:00Z", "qa/answer", 2) to true),
            "a run of another prompt" to listOf(run("run-4", "2026-11-19T01:00:00Z", "world/review", 3) to true),
            "a run that has no verdict yet" to listOf(run("run-5", Instant.now().toString(), "qa/answer", 3) to null),
            "a run that never got a verdict and is long past two hours" to listOf(run("run-6", "2026-11-19T01:00:00Z", "qa/answer", 3) to null),
        )

        for ((case, runs) in cases) {
            givenRuns(*runs.toTypedArray())
            assertThrows(EvaluationRequiredException::class.java, { service.promote(operators.llm, "qa/answer", PromptPromoteRequest(3)) }, case)
        }

        verify(langfuse, never()).setPromptLabels("qa/answer", 3, listOf("production"))
        assertEquals(0, mockingDetails(activities).invocations.size)
    }

    @Test
    fun `a version that already has the production label is returned as it is`() {
        givenRuns()
        `when`(langfuse.prompt("qa/answer", 2)).thenReturn(version("qa/answer", 2, """["production"]"""))

        val same = service.promote(operators.llm, "qa/answer", PromptPromoteRequest(2))

        assertEquals(listOf("production"), same.labels)
        verify(langfuse, never()).setPromptLabels("qa/answer", 2, listOf("production"))
        verifyNoInteractions(activities)
    }

    @Test
    fun `a missing version stays 404 an invalid version is 400 and a Langfuse failure is 502`() {
        `when`(langfuse.prompt("qa/answer", 9)).thenThrow(ResponseStatusException(HttpStatus.NOT_FOUND))
        `when`(langfuse.prompt("qa/answer", 8)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        assertEquals(HttpStatus.NOT_FOUND, assertThrows(ResponseStatusException::class.java) { service.promote(operators.llm, "qa/answer", PromptPromoteRequest(9)) }.statusCode)
        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { service.promote(operators.llm, "qa/answer", PromptPromoteRequest(8)) }.statusCode)
        assertThrows(IllegalArgumentException::class.java) { service.promote(operators.llm, "qa/answer", PromptPromoteRequest(0)) }
        verifyNoInteractions(activities)
    }
}
