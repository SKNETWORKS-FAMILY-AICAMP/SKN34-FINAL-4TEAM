package ai.storyfork.operations.llmops

import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations.llmops.service.TraceService
import ai.storyfork.operations.llmops.service.toTraceFact
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import tools.jackson.databind.JsonNode

/**
 * The real answer of the Observations API v2 for one orchestration trace of the E2E stack (13 observations, read with every field group but
 * trace_context, the project key replaced): the fixtures must look like it and the readers must cope with it. The trace predates the AI
 * instrumentation contract, so it has no status, no tags and two roots.
 */
class LangfuseV4SampleTest {
    private val real: List<JsonNode> = json(String(checkNotNull(javaClass.getResourceAsStream("/langfuse/v4-sample-trace.json")).readAllBytes(), Charsets.UTF_8)).path("data").values().toList()
    private val traceId = "ea9f373f0d7ed9397a3cba6ef105727d"
    private val member = "b832d965-0352-4eb1-b896-7a307ba09a68"
    private val langfuse = mock(LangfuseClient::class.java)

    @Test
    fun `the fixture builder writes exactly the keys of a real observation`() {
        val keys = real.first().propertyNames().toSet()

        // The trace list and the detail also ask for the trace_context group, which the sample was read without.
        assertEquals(keys + setOf("traceName", "release", "tags"), observation("t", "o").propertyNames().toSet())
        for (observation in real) assertEquals(keys, observation.propertyNames().toSet())
    }

    @Test
    fun `the real trace reads into a detail with its steps tokens cost and request`() {
        val operators = Operators()
        val detailService = TraceService(operators.permissions, langfuse)
        `when`(langfuse.traceObservations(traceId)).thenReturn(real)

        val detail = detailService.detail(operators.llm, traceId)

        assertEquals(traceId, detail.id)
        // Without tags the root's own name is the feature, and a root without a status has none.
        assertEquals(listOf("orchestration", "unknown", member, "503ff4d0-7ebd-439d-9430-c3dd7990d7d6"), listOf(detail.feature, detail.status, detail.userId, detail.workId))
        assertEquals(6885L, detail.latencyMs)
        assertEquals(13, detail.observations.size)
        assertEquals("writing_ai.orchestration", detail.observations.first().name)
        assertEquals(listOf(8333L, 148L), listOf(detail.inputTokens, detail.outputTokens))
        assertEquals(0.000907299999, detail.cost, 1e-12)
        assertEquals("3화까지 길동의 형은 누구야?", detail.input?.path("request")?.asString())
        assertEquals("3화까지 설정에서 길동의 형은 길현입니다. 길현은 홍문의 맏아들이자 길동의 이복형으로 명시되어 있습니다.", detail.output?.asString())
        val failedRetrieval = detail.observations.single { it.id == "b3a419f0c6fd25f7" }
        assertEquals(listOf("RETRIEVER", "ERROR", "원고 Q&A를 사용할 수 없어요."), listOf(failedRetrieval.type, failedRetrieval.level, failedRetrieval.statusMessage))
        assertNull(failedRetrieval.model)
        val main = detail.observations.single { it.id == "d1ec6482b48fd5e0" }
        assertEquals(listOf("gpt-6-luna", 1071L, 40L, "orchestration.main", 1), listOf(main.model, main.inputTokens, main.outputTokens, main.promptName, main.promptVersion))
        assertEquals(1507L, main.latencyMs)
    }

    @Test
    fun `the two real roots read into facts with empty text as no value`() {
        val facts = real.filter { it.path("isRootObservation").asBoolean(false) }.map { it.toTraceFact() }.associateBy { it.feature }

        val span = facts.getValue("orchestration")
        assertEquals(listOf(traceId, member, 6885L), listOf(span.id, span.userId, span.latencyMs))
        assertNull(span.status)
        // The physical root closes at once and has no member: "" in the answer, null here.
        val chain = facts.getValue("writing_ai.orchestration")
        assertNull(chain.userId)
        assertEquals(1L, chain.latencyMs)
    }
}
