package ai.storyfork.operations.llmops

import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.ObservationUsage
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
    fun `a page maps each trace with its tokens and the paging numbers`() {
        val first = trace("t-1", "2026-11-19T01:00:00Z", "qa", "failed", 2.5, 0.05, "user-1", """{"work_id":"w-1"}""")
        val second = trace("t-2", "2026-11-19T00:30:00Z", "world", "success", null, 0.0, null)
        `when`(langfuse.traces(null, null, emptyList(), null, null, 3, 20)).thenReturn(page(57, first, second))
        usageRows = listOf(ObservationUsage("t-1", "gpt-5", 100, 20, 0.04), ObservationUsage("t-1", "mini", 7, 3, 0.01))

        val result = service.list(operators.llm, null, null, null, null, null, null, 2)

        assertEquals(listOf<Any>(2, 20, 57L), listOf(result.page, result.size, result.total))
        val item = result.items[0]
        assertEquals(listOf("t-1", "qa", "failed", 2500L), listOf(item.id, item.feature, item.status, item.latencyMs))
        assertEquals(Instant.parse("2026-11-19T01:00:00Z"), item.timestamp)
        assertEquals(listOf(107L, 23L), listOf(item.inputTokens, item.outputTokens))
        assertEquals(0.05, item.cost)
        assertEquals(listOf("user-1", "w-1"), listOf(item.userId, item.workId))
        val bare = result.items[1]
        assertEquals(listOf(0L, 0L, 0L, 0.0), listOf(bare.latencyMs, bare.inputTokens, bare.outputTokens, bare.cost))
        assertNull(bare.userId)
        assertNull(bare.workId)
        // One usage query for the whole page, from just before its oldest trace, narrowed to the page's trace ids.
        val usageCall = mockingDetails(langfuse).invocations.single { it.method.name == "observationUsage" }
        assertEquals(Instant.parse("2026-11-19T00:29:00Z"), usageCall.arguments[0])
        assertEquals(listOf("t-1", "t-2"), usageCall.arguments[2])
    }

    @Test
    fun `feature and status become tags and every filter reaches Langfuse as given`() {
        `when`(langfuse.traces(from, to, listOf("feature:qa", "status:failed"), "user-1", "req-9", 1, 20)).thenReturn(page(0))

        val result = service.list(operators.llm, from, to, "qa", "failed", "user-1", "req-9", 0)

        assertTrue(result.items.isEmpty())
        assertEquals(0L, result.total)
        verify(langfuse).traces(from, to, listOf("feature:qa", "status:failed"), "user-1", "req-9", 1, 20)
    }

    @Test
    fun `blank filters are dropped and an empty page makes no usage call`() {
        `when`(langfuse.traces(null, null, emptyList(), null, null, 1, 20)).thenReturn(page(0))

        service.list(operators.llm, null, null, "  ", "", " ", "", 0)

        verify(langfuse).traces(null, null, emptyList(), null, null, 1, 20)
        assertEquals(listOf("traces"), mockingDetails(langfuse).invocations.map { it.method.name })
    }

    @Test
    fun `an unknown status or a negative page is rejected before Langfuse is called`() {
        assertThrows(IllegalArgumentException::class.java) { service.list(operators.llm, null, null, null, "done", null, null, 0) }
        assertThrows(IllegalArgumentException::class.java) { service.list(operators.llm, null, null, null, null, null, null, -1) }

        verifyNoInteractions(langfuse)
    }

    @Test
    fun `a trace detail maps its steps in time order with latency tokens level and prompt`() {
        `when`(langfuse.trace("t-1")).thenReturn(json("""{
            "id":"t-1","timestamp":"2026-11-19T01:00:00Z","userId":"user-1","tags":["feature:qa","status:failed"],"metadata":{"work_id":"w-1"},
            "latency":2.5,"totalCost":0.05,"input":{"question":"질문"},"output":"답",
            "observations":[
              {"id":"o2","name":"llm-call","type":"GENERATION","startTime":"2026-11-19T01:00:01.500Z","endTime":"2026-11-19T01:00:02.500Z",
               "model":"gpt-5","usageDetails":{"input":100,"output":20,"total":120},"level":"ERROR","statusMessage":"timeout","promptName":"qa/answer","promptVersion":3},
              {"id":"o1","name":"retrieve","type":"SPAN","startTime":"2026-11-19T01:00:00Z","endTime":"2026-11-19T01:00:01.500Z","level":"DEFAULT"},
              {"id":"o3","name":"legacy","type":"GENERATION","startTime":"2026-11-19T01:00:02.500Z","endTime":null,"model":"mini","usage":{"promptTokens":7,"completionTokens":3}}]}"""))

        val detail = service.detail(operators.llm, "t-1")

        assertEquals(listOf("t-1", "qa", "failed", 2500L), listOf(detail.id, detail.feature, detail.status, detail.latencyMs))
        assertEquals(listOf(107L, 23L, 0.05), listOf(detail.inputTokens, detail.outputTokens, detail.cost))
        assertEquals(listOf("user-1", "w-1"), listOf(detail.userId, detail.workId))
        assertEquals("질문", detail.input?.path("question")?.asString())
        assertEquals("답", detail.output?.asString())
        assertEquals(listOf("o1", "o2", "o3"), detail.observations.map { it.id })
        val retrieve = detail.observations[0]
        assertEquals(listOf("retrieve", "SPAN", 1500L, "DEFAULT"), listOf(retrieve.name, retrieve.type, retrieve.latencyMs, retrieve.level))
        assertNull(retrieve.model)
        assertNull(retrieve.inputTokens)
        assertNull(retrieve.promptName)
        val call = detail.observations[1]
        assertEquals(listOf("gpt-5", 100L, 20L, "ERROR", "timeout"), listOf(call.model, call.inputTokens, call.outputTokens, call.level, call.statusMessage))
        assertEquals(listOf("qa/answer", 3), listOf(call.promptName, call.promptVersion))
        assertEquals(Instant.parse("2026-11-19T01:00:01.500Z"), call.startTime)
        assertEquals(1000L, call.latencyMs)
        val legacy = detail.observations[2]
        assertEquals(listOf(7L, 3L, 0L), listOf(legacy.inputTokens, legacy.outputTokens, legacy.latencyMs))
        assertNull(legacy.endTime)
    }

    @Test
    fun `a missing trace stays 404 and a Langfuse failure stays 502`() {
        `when`(langfuse.trace("missing")).thenThrow(ResponseStatusException(HttpStatus.NOT_FOUND))
        `when`(langfuse.trace("broken")).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        assertEquals(HttpStatus.NOT_FOUND, assertThrows(ResponseStatusException::class.java) { service.detail(operators.llm, "missing") }.statusCode)
        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { service.detail(operators.llm, "broken") }.statusCode)
    }
}
