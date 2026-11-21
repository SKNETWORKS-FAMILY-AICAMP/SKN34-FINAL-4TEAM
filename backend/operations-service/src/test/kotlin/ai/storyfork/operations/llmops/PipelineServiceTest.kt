package ai.storyfork.operations.llmops

import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.ObservationGroup
import ai.storyfork.operations._common.client.TraceRoots
import ai.storyfork.operations.llmops.service.PipelineService
import java.time.Duration
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** Mocked Langfuse client and permission repository: no network, Spring context or database. */
class PipelineServiceTest {
    // Every read answers empty unless a test stubs it, so a test only states what it is about.
    private val langfuse = mock(LangfuseClient::class.java) { call ->
        if (call.method.name == "pipelineObservations") TraceRoots(emptyList(), 0) else RETURNS_DEFAULTS.answer(call)
    }
    private val operators = Operators()
    private val service = PipelineService(operators.permissions, langfuse)
    private val from = Instant.parse("2026-11-14T00:00:00Z")
    private val to = Instant.parse("2026-11-21T00:00:00Z")
    private val orchestration = listOf("orchestration")
    private val standalone = listOf("proposals", "initial_world", "manuscript_extraction", "work_tags", "world_review", "rating", "writing_editing")
    private val guardNames = setOf("decision_guard", "decision_guard.generation")

    private fun status(call: () -> Unit) = assertThrows(ResponseStatusException::class.java) { call() }.statusCode

    /** The rules the records reads gave Langfuse, in order: feature, names, prefix, level, skip, limit. */
    private fun rules() = mockingDetails(langfuse).invocations.filter { it.method.name == "pipelineObservations" }.map { it.arguments.toList().drop(2) }

    @Test
    fun `only an operator with the llm permission reads the pipeline`() {
        for (denied in listOf(operators.jobs, operators.none, operators.stale)) {
            assertEquals(HttpStatus.FORBIDDEN, status { service.pipeline(denied, from, to) })
            // Nothing about the input is looked at before the permission: not even an unknown node.
            assertEquals(HttpStatus.FORBIDDEN, status { service.records(denied, "no-such-node", from, to, null, 0) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.records(denied, "guard", from, to, "FATAL", -1) })
        }

        verifyNoInteractions(langfuse)
    }

    @Test
    fun `the pipeline is the fixed node list in flow order and a node without observations is zero`() {
        val nodes = service.pipeline(operators.llm, from, to).nodes
        val byId = nodes.associateBy { it.id }
        val agents = listOf("qa", "writing", "manuscript_review", "world", "research", "rating", "character_simulation")

        assertEquals(
            listOf("request", "guard", "main") + agents + listOf("mcp", "apply", "proposals", "initial_world", "manuscript_extraction", "work_tags", "world_review", "rating_direct", "writing_editing"),
            nodes.map { it.id },
        )
        assertEquals(listOf("집필 AI 요청", "Decision Guard", "메인 에이전트", "Content MCP 도구", "작가 승인 반영"), listOf("request", "guard", "main", "mcp", "apply").map { byId.getValue(it).label })
        assertEquals(listOf("guard"), byId.getValue("request").next)
        assertEquals(listOf("main"), byId.getValue("guard").next)
        assertEquals(agents + "mcp", byId.getValue("main").next)
        for (id in agents) assertEquals(listOf("apply"), byId.getValue(id).next, id)
        // Tools and the approval end the flow, and a standalone feature stands beside it: it has no links.
        assertEquals(listOf(emptyList<String>(), emptyList<String>()), listOf("mcp", "apply").map { byId.getValue(it).next })
        assertEquals(listOf("proposals", "initial_world", "manuscript_extraction", "work_tags", "world_review", "rating_direct", "writing_editing"), nodes.filter { it.standalone }.map { it.id })
        assertTrue(nodes.filter { it.standalone }.all { it.next.isEmpty() })
        assertTrue(nodes.flatMap { it.next }.all { it in byId })
        assertTrue(nodes.all { it.count == 0L && it.errors == 0L && it.p95LatencyMs == null && it.promptNames.isEmpty() })
    }

    @Test
    fun `a node counts the observations of its own names with their errors prompts and its slowest p95`() {
        `when`(langfuse.observationGroups(from, to, orchestration)).thenReturn(listOf(
            ObservationGroup("decision_guard", "DEFAULT", null, 10),
            ObservationGroup("decision_guard.generation", "DEFAULT", "decision_guard.judge", 8),
            ObservationGroup("decision_guard.generation", "ERROR", "decision_guard.judge", 2),
            ObservationGroup("step.story_context", "DEFAULT", null, 5), ObservationGroup("qa.generation", "DEFAULT", "story_context.answer", 5),
            ObservationGroup("step.rating", "DEFAULT", null, 7), ObservationGroup("rating.generation", "DEFAULT", "rating.assess", 7),
            ObservationGroup("step.writing_editing", "DEFAULT", null, 6), ObservationGroup("writing.generation", "DEFAULT", "writing.draft", 6),
            ObservationGroup("mcp.work_read", "DEFAULT", null, 4), ObservationGroup("mcp.world_studio_edit_draft", "ERROR", null, 1),
            ObservationGroup("step.world.apply", "DEFAULT", null, 2),
            // A name no node lists is counted nowhere.
            ObservationGroup("somebody_elses_span", "DEFAULT", null, 99),
        ))
        `when`(langfuse.observationLatencies(from, to, orchestration)).thenReturn(mapOf(
            "decision_guard" to 100.0, "decision_guard.generation" to 820.4, "step.story_context" to 3000.0, "qa.generation" to 2500.0,
            "mcp.work_read" to 50.0, "mcp.world_studio_edit_draft" to 400.0, "somebody_elses_span" to 9999.0,
        ))
        `when`(langfuse.observationGroups(from, to, standalone)).thenReturn(listOf(
            ObservationGroup("proposals", "DEFAULT", null, 3), ObservationGroup("proposals.generation", "DEFAULT", "proposals.suggest", 3),
            ObservationGroup("rating", "ERROR", null, 1), ObservationGroup("rating.generation", "DEFAULT", "rating.assess", 2),
            // The standalone writing request is named writing_editing but its model call writing.generation.
            ObservationGroup("writing_editing", "DEFAULT", null, 2), ObservationGroup("writing.generation", "DEFAULT", "writing.draft", 2),
        ))
        `when`(langfuse.observationLatencies(from, to, standalone)).thenReturn(mapOf("proposals" to 12000.0, "rating" to 4000.6, "writing.generation" to 9000.0))

        val nodes = service.pipeline(operators.llm, from, to).nodes.associateBy { it.id }

        fun figures(id: String) = nodes.getValue(id).let { listOf(it.count, it.errors, it.p95LatencyMs, it.promptNames) }
        // The p95 of a node is the largest of the p95 of its names; the prompts are those linked to its model calls.
        assertEquals(listOf<Any?>(20L, 2L, 820L, listOf("decision_guard.judge")), figures("guard"))
        assertEquals(listOf<Any?>(10L, 0L, 3000L, listOf("story_context.answer")), figures("qa"))
        assertEquals(listOf<Any?>(5L, 1L, 400L, emptyList<String>()), figures("mcp"))
        assertEquals(listOf<Any?>(2L, 0L, null, emptyList<String>()), figures("apply"))
        assertEquals(listOf<Any?>(0L, 0L, null, emptyList<String>()), figures("request"))
        // The same names are counted in the request they belong to: the rating agent of the chat and the rating of its own request are two nodes.
        assertEquals(listOf<Any?>(14L, 0L, null, listOf("rating.assess")), figures("rating"))
        assertEquals(listOf<Any?>(3L, 1L, 4001L, listOf("rating.assess")), figures("rating_direct"))
        assertEquals(listOf<Any?>(6L, 0L, 12000L, listOf("proposals.suggest")), figures("proposals"))
        assertEquals(listOf<Any?>(12L, 0L, null, listOf("writing.draft")), figures("writing"))
        assertEquals(listOf<Any?>(4L, 0L, 9000L, listOf("writing.draft")), figures("writing_editing"))
        assertEquals(20L + 10 + 14 + 5 + 2 + 3 + 6 + 12 + 4, nodes.values.sumOf { it.count })
    }

    @Test
    fun `the window defaults to the last seven days and an empty or backwards window is rejected before any call`() {
        assertThrows(IllegalArgumentException::class.java) { service.pipeline(operators.llm, to, from) }
        assertThrows(IllegalArgumentException::class.java) { service.pipeline(operators.llm, from, from) }
        assertThrows(IllegalArgumentException::class.java) { service.records(operators.llm, "guard", to, from, null, 0) }
        verifyNoInteractions(langfuse)

        val before = Instant.now()
        service.pipeline(operators.llm, null, null)
        service.records(operators.llm, "guard", null, null, null, 0)

        val windows = mockingDetails(langfuse).invocations.filter { it.method.name in setOf("observationGroups", "pipelineObservations") }
            .map { it.arguments[0] as Instant to it.arguments[1] as Instant }
        assertEquals(3, windows.size)
        for ((start, end) in windows) {
            assertEquals(Duration.ofDays(7), Duration.between(start, end))
            assertFalse(end.isBefore(before))
        }
    }

    @Test
    fun `a Langfuse failure is a 502 and never a pipeline of zeros`() {
        `when`(langfuse.observationGroups(from, to, orchestration)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))
        `when`(langfuse.pipelineObservations(from, to, "orchestration", guardNames, null, null, 0, 20)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        assertEquals(HttpStatus.BAD_GATEWAY, status { service.pipeline(operators.llm, from, to) })
        assertEquals(HttpStatus.BAD_GATEWAY, status { service.records(operators.llm, "guard", from, to, null, 0) })
    }

    @Test
    fun `a node's records are its observations newest first with their bodies and the paging numbers`() {
        val guard = observation("t-1", "o1", name = "decision_guard", parent = "root-t-1", startTime = "2026-11-20T01:00:00Z", latency = 0.25,
            input = """{"request":"질문"}""", output = """{"allowed":false,"reason":"out_of_scope","capabilities":[]}""", metadata = mapOf("turn" to "1"))
        val judge = generation("t-1", "o2", name = "decision_guard.generation", parent = "o1", startTime = "2026-11-20T01:00:00.050Z", latency = null, model = "gpt-6-luna",
            level = "ERROR", statusMessage = "timeout", promptName = "decision_guard.judge", promptVersion = 4, output = "그냥 글")
        `when`(langfuse.pipelineObservations(from, to, "orchestration", guardNames, null, null, 40, 20)).thenReturn(TraceRoots(listOf(guard, judge), 57))

        val page = service.records(operators.llm, "guard", from, to, null, 2)

        assertEquals(listOf<Any?>(2, 20, 57L), listOf(page.page, page.size, page.total))
        val first = page.items[0]
        assertEquals(listOf<Any?>("o1", "t-1", "decision_guard", "SPAN", 250L, "DEFAULT"), listOf(first.id, first.traceId, first.name, first.type, first.latencyMs, first.level))
        assertEquals(Instant.parse("2026-11-20T01:00:00Z"), first.startTime)
        // Text that is a JSON object comes back as JSON. No model, prompt or status message is null.
        assertEquals(listOf<Any?>("질문", false, "out_of_scope", "1"),
            listOf(first.input?.path("request")?.asString(), first.output?.path("allowed")?.asBoolean(), first.output?.path("reason")?.asString(), first.metadata?.path("turn")?.asString()))
        assertEquals(listOf(null, null, null, null), listOf(first.statusMessage, first.model, first.promptName, first.promptVersion))
        val second = page.items[1]
        assertEquals(listOf<Any?>("gpt-6-luna", "ERROR", "timeout", "decision_guard.judge", 4, 0L), listOf(second.model, second.level, second.statusMessage, second.promptName, second.promptVersion, second.latencyMs))
        assertEquals("그냥 글", second.output?.asString())
        assertNull(second.input)
    }

    @Test
    fun `a node is read by its own rule - a list of names or a family prefix or every observation of a standalone feature`() {
        service.records(operators.llm, "guard", from, to, "ERROR", 0)
        service.records(operators.llm, "mcp", from, to, null, 1)
        service.records(operators.llm, "rating_direct", from, to, "", 0)
        service.records(operators.llm, "rating", from, to, null, 0)

        assertEquals(listOf(
            listOf("orchestration", guardNames, null, "ERROR", 0, 20),
            listOf("orchestration", emptySet<String>(), "mcp.", null, 20, 20),
            // The standalone request is tagged feature:rating and all its observations are named after the key.
            listOf("rating", emptySet<String>(), "rating", null, 0, 20),
            listOf("orchestration", setOf("step.rating", "rating.generation"), null, null, 0, 20),
        ), rules())
    }

    @Test
    fun `the names of every node are the observation names of the AI service`() {
        val expected = mapOf(
            "request" to setOf("orchestration"),
            "guard" to guardNames,
            "main" to setOf("main_agent", "main_agent.blocked"),
            "qa" to setOf("step.story_context", "story_context.qa", "qa.generation", "retrieval", "retrieval.embedding", "retrieval.elasticsearch", "retrieval.postgres_verify", "world_read", "evidence_check"),
            "writing" to setOf("step.writing_editing", "writing.plan", "writing.plan_pick", "writing.plan_revise", "writing.generation"),
            "manuscript_review" to setOf("step.manuscript_review", "manuscript_review.generation"),
            "world" to setOf("step.world", "world_review", "world_review.generation", "world_review.enrich", "world_review.enrich.generation", "world_review.impact", "world_review.impact.generation"),
            "research" to setOf("step.research", "research.generation", "research.platform_pick", "research.platform_refer"),
            "rating" to setOf("step.rating", "rating.generation"),
            "character_simulation" to setOf("step.character_simulation", "step.character_simulation.plan", "simulation.plan", "simulation.act", "simulation.narrate", "simulation.check", "simulation.director", "simulation.turn"),
            "apply" to setOf("step.writing_editing.apply", "step.world.apply", "step.character_simulation.apply"),
        )
        for ((id, names) in expected) service.records(operators.llm, id, from, to, null, 0)

        assertEquals(expected.values.toList(), rules().map { it[1] })
        assertEquals(listOf("orchestration"), rules().map { it[0] }.distinct())
        // A standalone feature is its own request: the feature key is the tag and the prefix of the names in it (the request writing_editing has writing.generation).
        val requests = mapOf("proposals" to "proposals", "initial_world" to "initial_world", "manuscript_extraction" to "manuscript_extraction", "work_tags" to "work_tags",
            "world_review" to "world_review", "writing_editing" to "writing")
        for (id in requests.keys) service.records(operators.llm, id, from, to, null, 0)

        assertEquals(requests.map { (key, prefix) -> listOf(key, emptySet<String>(), prefix) }, rules().takeLast(requests.size).map { it.take(3) })
    }

    @Test
    fun `an unknown level and a page outside the newest 1000 observations are rejected before Langfuse is called`() {
        assertThrows(IllegalArgumentException::class.java) { service.records(operators.llm, "guard", from, to, "FATAL", 0) }
        assertThrows(IllegalArgumentException::class.java) { service.records(operators.llm, "guard", from, to, "error", 0) }
        assertThrows(IllegalArgumentException::class.java) { service.records(operators.llm, "guard", from, to, null, -1) }
        assertThrows(IllegalArgumentException::class.java) { service.records(operators.llm, "guard", from, to, null, 50) }
        verifyNoInteractions(langfuse)

        // Page 49 is the last: 980 are passed over and 20 shown.
        for (level in listOf("DEBUG", "DEFAULT", "WARNING", "ERROR")) service.records(operators.llm, "guard", from, to, level, 49)

        assertEquals(listOf("DEBUG", "DEFAULT", "WARNING", "ERROR"), rules().map { it[3] })
        assertEquals(setOf(980), rules().map { it[4] }.toSet())
    }

    @Test
    fun `an unknown node is a 404 answered before the window the level or the page is looked at`() {
        assertThrows(NoSuchElementException::class.java) { service.records(operators.llm, "no-such-node", to, from, "FATAL", -1) }

        verifyNoInteractions(langfuse)
    }

    @Test
    fun `a record body longer than 8000 characters is cut and a time that cannot be read is a 502`() {
        val long = observation("t-1", "o1", name = "main_agent", input = "가".repeat(9_000), output = "나".repeat(8_000))
        `when`(langfuse.pipelineObservations(from, to, "orchestration", setOf("main_agent", "main_agent.blocked"), null, null, 0, 20)).thenReturn(TraceRoots(listOf(long), 1))
        val unreadable = json("""{"id":"o","traceId":"t-2","type":"SPAN","startTime":"not a time"}""")
        `when`(langfuse.pipelineObservations(from, to, "orchestration", guardNames, null, null, 0, 20)).thenReturn(TraceRoots(listOf(unreadable), 1))

        val record = service.records(operators.llm, "main", from, to, null, 0).items.single()

        assertEquals(listOf(8_000, 8_000), listOf(record.input?.asString()?.length, record.output?.asString()?.length))
        assertEquals(HttpStatus.BAD_GATEWAY, status { service.records(operators.llm, "guard", from, to, null, 0) })
    }
}
