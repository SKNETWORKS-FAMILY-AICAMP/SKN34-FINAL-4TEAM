package ai.storyfork.operations.llmops

import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.ObservationUsage
import ai.storyfork.operations._common.client.TraceRoots
import ai.storyfork.operations.llmops.service.TraceService
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** Mocked Langfuse client and permission repository: no network, Spring context or database. */
class TraceServiceTest {
    // Only the usage query is answered by default; every other call is stubbed by the test that needs it.
    private var usageRows: List<ObservationUsage> = emptyList()
    private val langfuse = mock(LangfuseClient::class.java) { call -> if (call.method.name == "observationUsage") usageRows else null }
    private val operators = Operators()
    private val service = TraceService(operators.permissions, langfuse)
    private val from = Instant.parse("2026-11-18T00:00:00Z")
    private val to = Instant.parse("2026-11-19T00:00:00Z")

    private fun assertForbidden(call: () -> Unit) {
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException::class.java) { call() }.statusCode)
    }

    @Test
    fun `only an operator with the llm permission reads traces`() {
        for (denied in listOf(operators.jobs, operators.none, operators.stale)) {
            assertForbidden { service.list(denied, null, null, null, null, null, null, 0) }
            assertForbidden { service.detail(denied, "t-1") }
        }

        verifyNoInteractions(langfuse)
    }

    @Test
    fun `a page maps each trace with its tokens cost and the paging numbers`() {
        val first = root("t-1", "2026-11-19T01:00:00Z", "qa", "failed", 2.5, "user-1", mapOf("work_id" to "w-1"))
        val second = root("t-2", "2026-11-19T00:30:00Z", "world", "success", null, userId = "")
        `when`(langfuse.traces(null, null, null, null, null, null, 40, 20)).thenReturn(TraceRoots(listOf(first, second), 57))
        usageRows = listOf(ObservationUsage("t-1", "gpt-5", 100, 20, 0.04), ObservationUsage("t-1", "mini", 7, 3, 0.01))

        val result = service.list(operators.llm, null, null, null, null, null, null, 2)

        assertEquals(listOf<Any>(2, 20, 57L), listOf(result.page, result.size, result.total))
        val item = result.items[0]
        assertEquals(listOf("t-1", "qa", "failed", 2500L), listOf(item.id, item.feature, item.status, item.latencyMs))
        assertEquals(Instant.parse("2026-11-19T01:00:00Z"), item.timestamp)
        assertEquals(listOf(107L, 23L), listOf(item.inputTokens, item.outputTokens))
        // The trace's cost is its generations' cost: a root has none of its own.
        assertEquals(0.05, item.cost, 1e-9)
        assertEquals(listOf("user-1", "w-1"), listOf(item.userId, item.workId))
        val bare = result.items[1]
        assertEquals(listOf(0L, 0L, 0L, 0.0), listOf(bare.latencyMs, bare.inputTokens, bare.outputTokens, bare.cost))
        assertNull(bare.userId)
        assertNull(bare.workId)
        // One usage query for the whole page, narrowed to its trace ids. A resumed turn's first generations are older than its last request,
        // so the window opens a week before the oldest line.
        val usageCall = mockingDetails(langfuse).invocations.single { it.method.name == "observationUsage" }
        assertEquals(Instant.parse("2026-11-12T00:30:00Z"), usageCall.arguments[0])
        assertEquals(listOf("t-1", "t-2"), usageCall.arguments[2])
    }

    @Test
    fun `feature status user request id and the page position reach Langfuse as given`() {
        `when`(langfuse.traces(from, to, "qa", "failed", "user-1", "req-9", 0, 20)).thenReturn(TraceRoots(emptyList(), 0))

        val result = service.list(operators.llm, from, to, "qa", "failed", "user-1", "req-9", 0)

        assertTrue(result.items.isEmpty())
        assertEquals(0L, result.total)
        verify(langfuse).traces(from, to, "qa", "failed", "user-1", "req-9", 0, 20)
    }

    @Test
    fun `blank filters are dropped and an empty page makes no usage call`() {
        `when`(langfuse.traces(null, null, null, null, null, null, 0, 20)).thenReturn(TraceRoots(emptyList(), 0))

        service.list(operators.llm, null, null, "  ", "", " ", "", 0)

        verify(langfuse).traces(null, null, null, null, null, null, 0, 20)
        assertEquals(listOf("traces"), mockingDetails(langfuse).invocations.map { it.method.name })
    }

    @Test
    fun `an unknown status a negative page or a page beyond the newest 1000 traces is rejected before Langfuse is called`() {
        assertThrows(IllegalArgumentException::class.java) { service.list(operators.llm, null, null, null, "done", null, null, 0) }
        assertThrows(IllegalArgumentException::class.java) { service.list(operators.llm, null, null, null, null, null, null, -1) }
        assertThrows(IllegalArgumentException::class.java) { service.list(operators.llm, null, null, null, null, null, null, 50) }

        verifyNoInteractions(langfuse)

        `when`(langfuse.traces(null, null, null, null, null, null, 980, 20)).thenReturn(TraceRoots(emptyList(), 1000))
        assertEquals(49, service.list(operators.llm, null, null, null, null, null, null, 49).page)
    }

    @Test
    fun `a trace detail maps its steps in time order with latency tokens cost level and prompt`() {
        val request = root("t-1", "2026-11-19T01:00:00Z", "qa", "failed", 2.5, "user-1", mapOf("work_id" to "w-1"), input = """{"question":"질문"}""", output = "답")
        val retrieve = observation("t-1", "o1", name = "retrieve", parent = "root-t-1", startTime = "2026-11-19T01:00:00.100Z", latency = 1.4)
        val call = generation("t-1", "o2", startTime = "2026-11-19T01:00:01.500Z", latency = 1.0, model = "gpt-5", inputTokens = 100, outputTokens = 20, cost = 0.04,
            promptName = "qa/answer", promptVersion = 3, level = "ERROR", statusMessage = "timeout")
        val unfinished = generation("t-1", "o3", startTime = "2026-11-19T01:00:02.500Z", latency = null, model = "mini", inputTokens = 7, outputTokens = 3, cost = 0.01)
        `when`(langfuse.traceObservations("t-1")).thenReturn(listOf(unfinished, call, retrieve, request))

        val detail = service.detail(operators.llm, "t-1")

        assertEquals(listOf("t-1", "qa", "failed", 2500L), listOf(detail.id, detail.feature, detail.status, detail.latencyMs))
        assertEquals(Instant.parse("2026-11-19T01:00:00Z"), detail.timestamp)
        assertEquals(listOf(107L, 23L), listOf(detail.inputTokens, detail.outputTokens))
        assertEquals(0.05, detail.cost, 1e-9)
        assertEquals(listOf("user-1", "w-1"), listOf(detail.userId, detail.workId))
        assertEquals("질문", detail.input?.path("question")?.asString())
        assertEquals("답", detail.output?.asString())
        assertEquals(listOf("root-t-1", "o1", "o2", "o3"), detail.observations.map { it.id })
        val step = detail.observations[1]
        assertEquals(listOf("retrieve", "SPAN", 1400L, "DEFAULT"), listOf(step.name, step.type, step.latencyMs, step.level))
        assertNull(step.model)
        assertNull(step.inputTokens)
        assertNull(step.promptName)
        assertNull(step.statusMessage)
        val model = detail.observations[2]
        assertEquals(listOf("gpt-5", 100L, 20L, "ERROR", "timeout"), listOf(model.model, model.inputTokens, model.outputTokens, model.level, model.statusMessage))
        assertEquals(listOf("qa/answer", 3), listOf(model.promptName, model.promptVersion))
        assertEquals(Instant.parse("2026-11-19T01:00:01.500Z"), model.startTime)
        assertEquals(1000L, model.latencyMs)
        val open = detail.observations[3]
        assertEquals(listOf(7L, 3L, 0L), listOf(open.inputTokens, open.outputTokens, open.latencyMs))
        assertNull(open.endTime)
    }

    @Test
    fun `a resumed turn shows its newest finished request and the generations of all its requests`() {
        val waiting = root("t-1", "2026-11-19T01:00:00Z", status = null, latency = 0.5, id = "r1")
        val finished = root("t-1", "2026-11-19T03:00:00Z", status = "success", latency = 4.0, id = "r2")
        val asking = generation("t-1", "g1", startTime = "2026-11-19T01:00:00.100Z", inputTokens = 50, outputTokens = 5, cost = 0.01, parent = "r1")
        val answering = generation("t-1", "g2", startTime = "2026-11-19T03:00:01Z", inputTokens = 70, outputTokens = 9, cost = 0.02, parent = "r2")
        `when`(langfuse.traceObservations("t-1")).thenReturn(listOf(answering, finished, asking, waiting))

        val detail = service.detail(operators.llm, "t-1")

        assertEquals(listOf("success", 4000L, Instant.parse("2026-11-19T03:00:00Z")), listOf(detail.status, detail.latencyMs, detail.timestamp))
        assertEquals(listOf(120L, 14L), listOf(detail.inputTokens, detail.outputTokens))
        assertEquals(0.03, detail.cost, 1e-9)
        assertEquals(listOf("r1", "g1", "r2", "g2"), detail.observations.map { it.id })
    }

    @Test
    fun `a trace that has not finished has no status`() {
        `when`(langfuse.traceObservations("t-1")).thenReturn(listOf(root("t-1", status = null)))

        assertEquals("unknown", service.detail(operators.llm, "t-1").status)
    }

    @Test
    fun `a trace Langfuse does not know is 404 and a Langfuse failure stays 502`() {
        `when`(langfuse.traceObservations("missing")).thenReturn(emptyList())
        `when`(langfuse.traceObservations("broken")).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        assertThrows(NoSuchElementException::class.java) { service.detail(operators.llm, "missing") }
        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { service.detail(operators.llm, "broken") }.statusCode)
    }

    @Test
    fun `a Langfuse answer that cannot be read is a 502 in the list and in the detail`() {
        val unreadableRoot = json("""{"traceId":"t-1","startTime":"yesterday"}""")
        val unreadableStep = json("""{"id":"o","traceId":"t-2","type":"SPAN","startTime":"not a time"}""")
        val request = root("t-2")
        `when`(langfuse.traces(null, null, null, null, null, null, 0, 20)).thenReturn(TraceRoots(listOf(unreadableRoot), 1))
        `when`(langfuse.traceObservations("t-2")).thenReturn(listOf(request, unreadableStep))

        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { service.list(operators.llm, null, null, null, null, null, null, 0) }.statusCode)
        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { service.detail(operators.llm, "t-2") }.statusCode)
    }

    @Test
    fun `a trace detail step carries its parent input output and metadata for the flow tree`() {
        val request = root("t-1", "2026-11-19T01:00:00Z", "orchestration", "success", 3.0)
        val guard = observation("t-1", "o1", name = "decision_guard", parent = "root-t-1", startTime = "2026-11-19T01:00:00.100Z",
            input = """{"request":"질문"}""", output = """{"allowed":true,"capabilities":["story_context"]}""", metadata = mapOf("turn" to "1"))
        val main = generation("t-1", "o2", name = "main_agent", parent = "o1", startTime = "2026-11-19T01:00:01Z", input = """[{"role":"user","content":"질문"}]""", output = "그냥 글")
        `when`(langfuse.traceObservations("t-1")).thenReturn(listOf(main, guard, request))

        val steps = service.detail(operators.llm, "t-1").observations

        assertEquals(listOf(null, "root-t-1", "o1"), steps.map { it.parentObservationId })
        assertNull(steps[0].input)
        // Text that is a JSON object or array comes back as JSON, any other text stays text.
        assertEquals("질문", steps[1].input?.path("request")?.asString())
        assertEquals(listOf<Any?>(true, "story_context"), listOf(steps[1].output?.path("allowed")?.asBoolean(), steps[1].output?.path("capabilities")?.path(0)?.asString()))
        assertEquals("1", steps[1].metadata?.path("turn")?.asString())
        assertEquals("user", steps[2].input?.path(0)?.path("role")?.asString())
        assertEquals("그냥 글", steps[2].output?.asString())
    }

    @Test
    fun `a step's metadata leaves out the keys the Langfuse SDK adds and keeps the rest`() {
        val sdk = mapOf("scope.attributes.public_key" to "pk-lf-1", "scope.version" to "4.18.0", "resourceAttributes.service.name" to "storyfork-ai", "resourceAttributes.telemetry.sdk.version" to "1.0")
        val guard = observation("t-1", "o1", name = "decision_guard", parent = "root-t-1", startTime = "2026-11-19T01:00:01Z", input = """{"scope.x":1}""",
            metadata = mapOf("turn" to "1", "scopes" to "kept", "resource" to "kept") + sdk)
        val bare = observation("t-1", "o2", parent = "root-t-1", startTime = "2026-11-19T01:00:02Z", metadata = sdk)
        `when`(langfuse.traceObservations("t-1")).thenReturn(listOf(root("t-1"), guard, bare))

        val steps = service.detail(operators.llm, "t-1").observations

        // Only the keys that start with "scope." or "resourceAttributes." go: the request root keeps its own, and so do names that merely look alike.
        assertEquals(listOf("request_id", "fork", "status"), steps[0].metadata?.propertyNames()?.toList())
        assertEquals(listOf("turn", "scopes", "resource"), steps[1].metadata?.propertyNames()?.toList())
        assertEquals("1", steps[1].metadata?.path("turn")?.asString())
        // The input is the writer's own text, whatever its keys are called.
        assertEquals(1, steps[1].input?.path("scope.x")?.asInt())
        // With nothing left the step has no metadata: null, not an empty object a screen would show as one.
        assertNull(steps[2].metadata)
    }

    @Test
    fun `the 8000 character limit of metadata counts only the keys that are shown`() {
        val big = observation("t-1", "o1", parent = "root-t-1", startTime = "2026-11-19T01:00:01Z", metadata = mapOf("note" to "다".repeat(100), "scope.attributes.big" to "라".repeat(9_000)))
        `when`(langfuse.traceObservations("t-1")).thenReturn(listOf(root("t-1"), big))

        val metadata = service.detail(operators.llm, "t-1").observations[1].metadata

        assertEquals(listOf(true, "다".repeat(100)), listOf(metadata?.isObject, metadata?.path("note")?.asString()))
    }

    @Test
    fun `a step body longer than 8000 characters is cut to its first 8000 and a body within the limit stays whole`() {
        val text = "가".repeat(9_000)
        val longJson = """{"text":"${"나".repeat(9_000)}"}"""
        val cut = observation("t-1", "o1", parent = "root-t-1", startTime = "2026-11-19T01:00:01Z", input = text, output = longJson, metadata = mapOf("note" to "다".repeat(9_000)))
        val whole = observation("t-1", "o2", parent = "root-t-1", startTime = "2026-11-19T01:00:02Z", input = "가".repeat(8_000), output = """{"text":"${"나".repeat(100)}"}""")
        `when`(langfuse.traceObservations("t-1")).thenReturn(listOf(root("t-1"), cut, whole))

        val steps = service.detail(operators.llm, "t-1").observations

        assertEquals(text.take(8_000), steps[1].input?.asString())
        // A cut JSON body is text, not JSON: its end is gone.
        assertEquals(listOf<Any?>(true, longJson.take(8_000)), listOf(steps[1].output?.isString, steps[1].output?.asString()))
        assertEquals(listOf<Any?>(true, 8_000), listOf(steps[1].metadata?.isString, steps[1].metadata?.asString()?.length))
        assertEquals(8_000, steps[2].input?.asString()?.length)
        assertTrue(steps[2].output?.isObject == true)
    }
}
