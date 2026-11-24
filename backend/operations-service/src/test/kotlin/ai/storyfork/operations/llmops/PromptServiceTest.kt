package ai.storyfork.operations.llmops

import ai.storyfork.operations._common.client.AiClient
import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.exception.CandidateRequiredException
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
            assertForbidden { service.candidate(denied, "qa/answer", PromptPromoteRequest(1)) }
        }

        verifyNoInteractions(langfuse, activities)
    }

    @Test
    fun `the list reads only the production and seed versions by label and counts candidates from the prompt labels`() {
        givenRuns(run("run-old", "2026-11-19T01:00:00Z", "qa/answer", 2) to false, run("run-new", "2026-11-19T02:00:00Z", "qa/answer", 2) to true)
        // Langfuse lists a prompt with the labels of all its versions; candidate-2 is on the production version, so only candidate-3 waits.
        `when`(langfuse.prompts()).thenReturn(listOf(json("""{"name":"qa/answer","versions":[1,4,3,2],"labels":["production","seed","latest","candidate-2","candidate-3"]}""")))
        `when`(langfuse.prompt("qa/answer", "production")).thenReturn(version("qa/answer", 2, """["production","candidate-2"]""", "2026-11-10T00:00:00Z"))
        `when`(langfuse.prompt("qa/answer", "seed")).thenReturn(version("qa/answer", 4, """["seed","latest"]"""))

        val prompt = service.list(operators.llm).items.single()

        assertEquals("qa/answer", prompt.name)
        assertEquals(1, prompt.candidates)
        assertEquals(listOf(4, 2), prompt.versions.map { it.version })
        assertEquals(listOf(listOf("seed", "latest"), listOf("production", "candidate-2")), prompt.versions.map { it.labels })
        assertEquals(listOf(null, Instant.parse("2026-11-10T00:00:00Z")), prompt.versions.map { it.createdAt })
        assertNull(prompt.versions[0].evaluation)
        val evaluation = checkNotNull(prompt.versions[1].evaluation)
        assertEquals(listOf("run-new", true, Instant.parse("2026-11-19T02:00:00Z")), listOf(evaluation.runId, evaluation.passed, evaluation.createdAt))
        verify(langfuse, never()).prompt(anyString(), anyInt())
    }

    @Test
    fun `the list reads a production version that is also the seed once and a prompt without either label not at all`() {
        givenRuns()
        `when`(langfuse.prompts()).thenReturn(listOf(
            json("""{"name":"qa","versions":[1,2,3],"labels":["production","seed","latest"]}"""), json("""{"name":"bare","versions":[1],"labels":["latest"]}"""),
        ))
        `when`(langfuse.prompt("qa", "production")).thenReturn(version("qa", 2, """["production","seed"]"""))

        val items = service.list(operators.llm).items

        assertEquals(listOf(listOf(2), emptyList()), items.map { prompt -> prompt.versions.map { it.version } })
        assertEquals(listOf(0, 0), items.map { it.candidates })
        verify(langfuse, times(1)).prompt(anyString(), anyString())
        verify(langfuse, never()).prompt(anyString(), anyInt())
    }

    @Test
    fun `a prompt version whose creation time cannot be read is a 502`() {
        givenRuns()
        `when`(langfuse.prompts()).thenReturn(listOf(json("""{"name":"qa/answer","versions":[1],"labels":["production"]}""")))
        `when`(langfuse.prompt("qa/answer", "production")).thenReturn(version("qa/answer", 1, """["production"]""", "never"))

        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { service.list(operators.llm) }.statusCode)
    }

    @Test
    fun `the detail is the prompt with exactly that name and an unknown name is not found`() {
        givenRuns()
        `when`(langfuse.prompts("qa")).thenReturn(listOf(json("""{"name":"qa/answer","versions":[1]}"""), json("""{"name":"qa","versions":[1],"labels":["production","candidate-1","candidate-5"]}""")))
        `when`(langfuse.prompt("qa", 1)).thenReturn(version("qa", 1, """["production"]"""))
        `when`(langfuse.prompts("nope")).thenReturn(emptyList())

        val detail = service.detail(operators.llm, "qa")
        assertEquals(listOf("qa", 1), listOf(detail.name, detail.candidates))
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
    fun `each version shows the model chosen in its config and only the detail carries the prompt body`() {
        givenRuns()
        val chosen = json("""{"name":"qa","version":2,"labels":["production","seed"],"prompt":"지시","config":{"model":"gpt-chosen"}}""")
        `when`(langfuse.prompts()).thenReturn(listOf(json("""{"name":"qa","versions":[1,2],"labels":["production","seed"]}""")))
        `when`(langfuse.prompt("qa", "production")).thenReturn(chosen)
        `when`(langfuse.prompts("qa")).thenReturn(listOf(json("""{"name":"qa","versions":[1,2]}""")))
        `when`(langfuse.prompt("qa", 2)).thenReturn(chosen)
        `when`(langfuse.prompt("qa", 1)).thenReturn(json("""{"name":"qa","version":1,"labels":[],"prompt":"옛 지시","config":{}}"""))

        val listed = service.list(operators.llm).items.single().versions
        val detail = service.detail(operators.llm, "qa").versions

        assertEquals(listOf("gpt-chosen"), listed.map { it.model })
        assertEquals(listOf(null), listed.map { it.prompt })
        assertEquals(listOf(json("\"지시\""), json("\"옛 지시\"")), detail.map { it.prompt })
    }

    @Test
    fun `a version may only choose a model Langfuse has a definition for`() {
        `when`(langfuse.models()).thenReturn(listOf(json("""{"id":"m1","modelName":"gpt-chosen","matchPattern":"x"}""")))
        val known = json("""{"model":"gpt-chosen"}""")
        `when`(langfuse.createPrompt(mapOf("name" to "qa", "type" to "text", "prompt" to json("\"지시\""), "labels" to emptyList<String>(), "config" to known)))
            .thenReturn(json("""{"name":"qa","version":5,"labels":["latest"],"config":{"model":"gpt-chosen"}}"""))

        assertEquals("gpt-chosen", service.create(operators.llm, "qa", PromptCreateRequest(json("\"지시\""), null, known)).model)
        for (bad in listOf("""{"model":"gpt-unknown"}""", """{"model":" "}""", """{"model":3}""")) {
            assertThrows(IllegalArgumentException::class.java) { service.create(operators.llm, "qa", PromptCreateRequest(json("\"지시\""), null, json(bad))) }
        }
        verify(langfuse, times(1)).createPrompt(anyMap())
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
    fun `a version becomes a candidate by its own candidate label and the change is recorded`() {
        givenRuns()
        `when`(langfuse.prompt("qa/answer", 3)).thenReturn(version("qa/answer", 3, """["latest","seed"]""", "2026-11-12T00:00:00Z"))

        val candidate = service.candidate(operators.llm, "qa/answer", PromptPromoteRequest(3))

        // Langfuse keeps a label on one version only, so each candidate carries its own version in the label and several candidates can coexist.
        assertEquals(listOf("latest", "seed", "candidate-3"), candidate.labels)
        val order = inOrder(langfuse, activities)
        order.verify(langfuse).setPromptLabels("qa/answer", 3, listOf("seed", "candidate-3"))
        order.verify(activities).record(operators.llm, "PROMPT_CANDIDATE", "PROMPT", "qa/answer", "v3")
    }

    @Test
    fun `promoting needs that version to be a candidate and no evaluation and moves the production label`() {
        givenRuns()
        `when`(langfuse.prompt("qa/answer", 3)).thenReturn(version("qa/answer", 3, """["latest","candidate-3"]""", "2026-11-12T00:00:00Z"))

        val promoted = service.promote(operators.llm, "qa/answer", PromptPromoteRequest(3))

        assertEquals(listOf(3, listOf("latest", "candidate-3", "production")), listOf(promoted.version, promoted.labels))
        val order = inOrder(langfuse, activities)
        // Langfuse manages "latest" itself; every other label the version already had is kept.
        order.verify(langfuse).setPromptLabels("qa/answer", 3, listOf("candidate-3", "production"))
        order.verify(activities).record(operators.llm, "PROMPT_PROMOTE", "PROMPT", "qa/answer", "v3")
    }

    @Test
    fun `a version that is not a candidate is not promoted even with a passing evaluation`() {
        givenRuns(run("run-1", "2026-11-19T01:00:00Z", "qa/answer", 3) to true)
        for (labels in listOf("""["latest"]""", """["candidate-2"]""", """["candidate"]""")) {
            `when`(langfuse.prompt("qa/answer", 3)).thenReturn(version("qa/answer", 3, labels))
            assertThrows(CandidateRequiredException::class.java, { service.promote(operators.llm, "qa/answer", PromptPromoteRequest(3)) }, labels)
        }

        verify(langfuse, never()).setPromptLabels(anyString(), anyInt(), anyList())
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
        assertThrows(IllegalArgumentException::class.java) { service.candidate(operators.llm, "qa/answer", PromptPromoteRequest(0)) }
        verifyNoInteractions(activities)
    }
}
