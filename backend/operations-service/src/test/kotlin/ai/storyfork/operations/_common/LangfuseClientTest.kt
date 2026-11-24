package ai.storyfork.operations._common

import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.ObservationGroup
import ai.storyfork.operations._common.client.langfuseRestClient
import java.time.Instant
import java.util.Base64
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.http.HttpMethod
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.JsonNode
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** 실제 RestClient 파이프라인을 메모리 요청 팩토리로 돌린다. 소켓·서버·Spring 컨텍스트가 없다. */
class LangfuseClientTest {
    private val mapper = jacksonMapperBuilder().build()
    private val from = Instant.parse("2026-11-18T00:00:00Z")
    private val to = Instant.parse("2026-11-19T00:00:00Z")
    private val observations = "/api/public/v2/observations"
    private val metrics = "/api/public/v2/metrics"
    private val nothing = """{"data":[],"meta":{}}"""

    private fun client(factory: RecordingRequestFactory) = LangfuseClient(
        langfuseRestClient("http://langfuse.test", "pk-lf-1", "sk-lf-2", mapper).requestFactory(factory).build(), mapper,
    )

    private fun status(call: () -> Unit) = assertThrows(ResponseStatusException::class.java) { call() }.statusCode.value()

    private fun conditions(filter: String): List<JsonNode> = mapper.readTree(filter).values().toList()

    private fun List<JsonNode>.of(column: String) = single { it.path("column").asString() == column }

    /** Metadata conditions are told apart by their key. */
    private fun List<JsonNode>.metadata(key: String) = single { it.path("column").asString() == "metadata" && it.path("key").asString() == key }

    private fun row(traceId: String) = """{"id":"o-$traceId","traceId":"$traceId"}"""

    /** A cursor page the way Langfuse answers: a missing cursor is the last page. */
    private fun page(vararg traceIds: String, cursor: String? = null): String {
        val meta = if (cursor == null) "{}" else """{"cursor":"$cursor"}"""
        return """{"data":[${traceIds.joinToString(",") { row(it) }}],"meta":$meta}"""
    }

    private fun items(count: Int, prefix: String) = (1..count).joinToString(",") { """{"id":"$prefix$it"}""" }

    private fun count(total: Int) = """{"data":[{"count_count":$total}]}"""

    /** Answers the metrics count of a trace list and gives every other read the same page. */
    private fun listing(answer: String) = RecordingRequestFactory { call -> Reply(200, if (call.uri.path == metrics) count(0) else answer) }

    @Test
    fun `requests carry the project keys as Basic auth and never the operations service token`() {
        val factory = RecordingRequestFactory { Reply(200, nothing) }

        client(factory).allTraces(from, to)

        val call = factory.calls.single()
        assertEquals("Basic " + Base64.getEncoder().encodeToString("pk-lf-1:sk-lf-2".toByteArray()), call.headers.getFirst("Authorization"))
        assertNull(call.headers.getFirst("X-Operations-Service-Token"))
        assertEquals(HttpMethod.GET, call.method)
        assertEquals(observations, call.uri.path)
    }

    @Test
    fun `a trace list reads finished request roots through the Observations API with every filter inside the filter parameter`() {
        val factory = listing(nothing)

        client(factory).traces(from, to, "qa", "failed", "user-1", "req-9", 0, 20)

        val call = factory.calls.first()
        assertEquals(observations, call.uri.path)
        // Langfuse lets the filter parameter win over the plain ones, so nothing may be left outside it.
        assertEquals(setOf("fields", "filter", "limit"), call.query.keys)
        assertEquals(listOf("20"), call.query["limit"])
        // The tags and the trace name only come back with the trace_context group.
        assertTrue(call.query.getValue("fields").single().split(",").containsAll(listOf("core", "basic", "metadata", "metrics", "trace_context")))
        val all = conditions(call.query.getValue("filter").single())
        val root = all.of("isRootObservation")
        assertEquals(listOf("boolean", "="), listOf(root.path("type").asString(), root.path("operator").asString()))
        assertTrue(root.path("value").asBoolean())
        val times = all.filter { it.path("column").asString() == "startTime" }
        assertEquals(listOf("datetime", "datetime"), times.map { it.path("type").asString() })
        assertEquals(listOf(">=", "<"), times.map { it.path("operator").asString() })
        assertEquals(listOf("2026-11-18T00:00:00Z", "2026-11-19T00:00:00Z"), times.map { it.path("value").asString() })
        val tags = all.of("tags")
        assertEquals(listOf("arrayOptions", "any of"), listOf(tags.path("type").asString(), tags.path("operator").asString()))
        assertEquals(listOf("feature:qa"), tags.path("value").values().map { it.asString() })
        val status = all.metadata("status")
        assertEquals(listOf("stringObject", "=", "failed"), listOf(status.path("type").asString(), status.path("operator").asString(), status.path("value").asString()))
        val user = all.of("userId")
        assertEquals(listOf("string", "=", "user-1"), listOf(user.path("type").asString(), user.path("operator").asString(), user.path("value").asString()))
        val request = all.metadata("request_id")
        assertEquals(listOf("stringObject", "=", "req-9"), listOf(request.path("type").asString(), request.path("operator").asString(), request.path("value").asString()))
    }

    @Test
    fun `a trace list without filters asks only for roots that carry a status`() {
        val factory = listing(nothing)

        client(factory).traces(null, null, null, null, null, null, 0, 20)

        val all = conditions(factory.calls.first().query.getValue("filter").single())
        // A request has finished when its root has a status: a waiting or cancelled one has none and is not a request.
        assertEquals(listOf("isRootObservation", "metadata"), all.map { it.path("column").asString() })
        val status = all.metadata("status")
        assertEquals(listOf("stringObject", "is set"), listOf(status.path("type").asString(), status.path("operator").asString()))
    }

    @Test
    fun `the total is a metrics count over the same filters and window`() {
        val factory = RecordingRequestFactory { call -> Reply(200, if (call.uri.path == metrics) count(57) else nothing) }

        val roots = client(factory).traces(from, to, "qa", "failed", "user-1", "req-9", 0, 20)

        assertEquals(57L, roots.total)
        assertTrue(roots.items.isEmpty())
        val (list, total) = factory.calls
        assertEquals(metrics, total.uri.path)
        val query = mapper.readTree(total.query.getValue("query").single())
        assertEquals("observations", query.path("view").asString())
        assertEquals(listOf("count" to "count"), query.path("metrics").values().map { it.path("measure").asString() to it.path("aggregation").asString() })
        assertEquals("2026-11-18T00:00:00Z", query.path("fromTimestamp").asString())
        assertEquals("2026-11-19T00:00:00Z", query.path("toTimestamp").asString())
        // The same conditions as the list; its time bounds are query fields here.
        val listed = conditions(list.query.getValue("filter").single()).filter { it.path("column").asString() != "startTime" }
        assertEquals(listed, query.path("filters").values().toList())
    }

    @Test
    fun `a trace list without a window counts from Langfuse's own floor until now`() {
        val factory = RecordingRequestFactory { call -> Reply(200, if (call.uri.path == metrics) count(3) else nothing) }
        val before = Instant.now()

        client(factory).traces(null, null, null, null, null, null, 0, 20)

        val after = Instant.now()
        val query = mapper.readTree(factory.calls[1].query.getValue("query").single())
        assertEquals("2020-01-01T00:00:00Z", query.path("fromTimestamp").asString())
        val end = Instant.parse(query.path("toTimestamp").asString())
        assertTrue(!end.isBefore(before.minusSeconds(1)) && !end.isAfter(after.plusSeconds(1)), end.toString())
        assertTrue(conditions(factory.calls[0].query.getValue("filter").single()).none { it.path("column").asString() == "startTime" })
    }

    @Test
    fun `later pages walk the cursors and skip the newer traces`() {
        val factory = RecordingRequestFactory { call ->
            when {
                call.uri.path == metrics -> Reply(200, count(9))
                call.query["cursor"] == null -> Reply(200, page("t1", "t2", "t3", cursor = "c1"))
                else -> Reply(200, page("t4"))
            }
        }

        val roots = client(factory).traces(null, null, null, null, null, null, 2, 2)

        assertEquals(listOf("t3", "t4"), roots.items.map { it.path("traceId").asString() })
        val reads = factory.calls.filter { it.uri.path == observations }
        // Four traces are wanted (two passed over, two shown): the first read asks for all of them, the second only for the one still missing.
        assertEquals(listOf(listOf("4"), listOf("1")), reads.map { it.query.getValue("limit") })
        assertEquals(listOf(null, listOf("c1")), reads.map { it.query["cursor"] })
    }

    @Test
    fun `a resumed turn shows as one line with its newest finished request`() {
        val factory = RecordingRequestFactory { call ->
            when {
                call.uri.path == metrics -> Reply(200, count(3))
                call.query["cursor"] == null -> Reply(200, """{"data":[{"id":"r-new","traceId":"t1"},{"id":"r-old","traceId":"t1"}],"meta":{"cursor":"c1"}}""")
                else -> Reply(200, page("t2"))
            }
        }

        val roots = client(factory).traces(null, null, null, null, null, null, 0, 2)

        // Roots come newest first, so the first root of a trace is its newest; the second read tops the page up with the line the merge cost.
        assertEquals(listOf("r-new", "o-t2"), roots.items.map { it.path("id").asString() })
        assertEquals(listOf(listOf("2"), listOf("1")), factory.calls.filter { it.uri.path == observations }.map { it.query.getValue("limit") })
    }

    @Test
    fun `a page that is empty while a cursor is present is followed but never forever`() {
        val endless = RecordingRequestFactory { Reply(200, """{"data":[],"meta":{"cursor":"again"}}""") }

        assertTrue(client(endless).allTraces(from, to).isEmpty())

        assertEquals(20, endless.calls.size)
        val late = RecordingRequestFactory { call -> Reply(200, if (call.query["cursor"] == null) """{"data":[],"meta":{"cursor":"c1"}}""" else page("t1")) }
        assertEquals(listOf("o-t1"), client(late).allTraces(from, to).map { it.path("id").asString() })
    }

    @Test
    fun `all traces are the roots of the window up to the newest 1000 finished or not`() {
        val full = page(*(1..1000).map { "t$it" }.toTypedArray(), cursor = "more")
        val factory = RecordingRequestFactory { Reply(200, full) }

        val roots = client(factory).allTraces(from, to)

        assertEquals(1000, roots.size)
        val call = factory.calls.single()
        assertEquals(listOf("1000"), call.query["limit"])
        assertEquals(setOf("fields", "filter", "limit"), call.query.keys)
        // Waiting and cancelled requests have no status, but their generations cost money, so a status is no condition here.
        val all = conditions(call.query.getValue("filter").single())
        assertEquals(listOf("isRootObservation", "startTime", "startTime"), all.map { it.path("column").asString() })
        val times = all.filter { it.path("column").asString() == "startTime" }
        assertEquals(listOf(">=", "<"), times.map { it.path("operator").asString() })
        assertEquals(listOf("2026-11-18T00:00:00Z", "2026-11-19T00:00:00Z"), times.map { it.path("value").asString() })
    }

    @Test
    fun `a short page is topped up from the next cursor`() {
        val factory = RecordingRequestFactory { call -> Reply(200, if (call.query["cursor"] == null) page("t1", "t2", "t3", cursor = "c1") else page("t4", "t5")) }

        val roots = client(factory).allTraces(from, to)

        assertEquals(listOf("t1", "t2", "t3", "t4", "t5"), roots.map { it.path("traceId").asString() })
        assertEquals(listOf(listOf("1000"), listOf("997")), factory.calls.map { it.query.getValue("limit") })
        assertEquals(listOf("c1"), factory.calls[1].query["cursor"])
    }

    @Test
    fun `the observations of a trace are read by its id as a filter value with every field group the detail needs`() {
        val factory = RecordingRequestFactory { Reply(200, page("a/b c")) }

        val steps = client(factory).traceObservations("a/b c")

        assertEquals(listOf("o-a/b c"), steps.map { it.path("id").asString() })
        val call = factory.calls.single()
        assertEquals(observations, call.uri.path)
        assertEquals(setOf("fields", "filter", "limit"), call.query.keys)
        assertEquals(listOf("1000"), call.query["limit"])
        assertTrue(call.query.getValue("fields").single().split(",").containsAll(listOf("core", "basic", "io", "metadata", "model", "usage", "prompt", "metrics", "trace_context")))
        val trace = conditions(call.query.getValue("filter").single()).single()
        assertEquals(listOf("string", "traceId", "=", "a/b c"), listOf(trace.path("type").asString(), trace.path("column").asString(), trace.path("operator").asString(), trace.path("value").asString()))
    }

    @Test
    fun `a 404 or any other failure on these reads is a 502 and never a not-found`() {
        val reads = listOf<(LangfuseClient) -> Unit>(
            { it.traces(null, null, null, null, null, null, 0, 20) }, { it.allTraces(from, to) }, { it.traceObservations("t-1") },
            { it.observationUsage(from, to) }, { it.experiments(from, null) }, { it.experimentScores(listOf("e-1")) },
            { it.observationGroups(from, to, listOf("rating")) }, { it.observationLatencies(from, to, listOf("rating")) },
            { it.pipelineObservations(from, to, "rating", setOf("rating.generation"), null, null, 0, 20) },
        )

        for (upstream in listOf(404, 401, 403, 400, 500, 503)) {
            for (read in reads) assertEquals(502, status { read(client(RecordingRequestFactory { Reply(upstream, """{"message":"x"}""") })) }, upstream.toString())
        }
        for (body in listOf("not-json", "")) {
            for (read in reads) assertEquals(502, status { read(client(RecordingRequestFactory { Reply(200, body) })) }, body)
        }
    }

    @Test
    fun `user input is a URI variable so reserved characters cannot add or change parameters`() {
        val hostile = "a&page=9=c+d/é #x"
        val factory = RecordingRequestFactory { call -> Reply(200, if (call.uri.path == metrics) count(0) else nothing) }
        val langfuse = client(factory)

        langfuse.traces(null, null, hostile, "failed", hostile, hostile, 0, 20)
        langfuse.experiments(from, hostile)
        langfuse.experimentScores(listOf(hostile))

        val list = factory.calls[0]
        assertEquals(setOf("fields", "filter", "limit"), list.query.keys)
        val all = conditions(list.query.getValue("filter").single())
        assertEquals(listOf("feature:$hostile"), all.of("tags").path("value").values().map { it.asString() })
        assertEquals(hostile, all.of("userId").path("value").asString())
        assertEquals(hostile, all.metadata("request_id").path("value").asString())
        val experiments = factory.calls[2]
        assertEquals(setOf("fromStartTime", "fields", "name", "limit"), experiments.query.keys)
        assertEquals(listOf(hostile), experiments.query["name"])
        assertTrue(experiments.uri.rawQuery.contains("name=a%26page%3D9%3Dc%2Bd%2F%C3%A9%20%23x"), experiments.uri.rawQuery)
        val scores = factory.calls[3]
        assertEquals(setOf("experimentId", "fields", "limit"), scores.query.keys)
        assertEquals(listOf(hostile), scores.query["experimentId"])
    }

    @Test
    fun `token usage is one Metrics API v2 query over generations grouped by trace and model with the biggest cost first`() {
        val rows = """{"data":[
            {"traceId":"t-1","providedModelName":"gpt-5","sum_inputTokens":"120","sum_outputTokens":"30","sum_totalCost":0.0125},
            {"traceId":"t-2","providedModelName":null,"sum_inputTokens":7,"sum_outputTokens":"3","sum_totalCost":"0.5"}]}"""
        val factory = RecordingRequestFactory { Reply(200, rows) }

        val usage = client(factory).observationUsage(from, to, listOf("t-1", "t-2"))

        val call = factory.calls.single()
        assertEquals(metrics, call.uri.path)
        val query = mapper.readTree(call.query.getValue("query").single())
        assertEquals("observations", query.path("view").asString())
        assertEquals(listOf("traceId", "providedModelName"), query.path("dimensions").values().map { it.path("field").asString() })
        assertEquals(listOf("inputTokens", "outputTokens", "totalCost"), query.path("metrics").values().map { it.path("measure").asString() })
        assertEquals(setOf("sum"), query.path("metrics").values().map { it.path("aggregation").asString() }.toSet())
        // Langfuse groups by a trace id only when the rows are limited and ordered by a measure, biggest first (it answers 400 otherwise).
        assertEquals(listOf("sum_totalCost" to "desc"), query.path("orderBy").values().map { it.path("field").asString() to it.path("direction").asString() })
        assertEquals(1000, query.path("config").path("row_limit").asInt())
        assertEquals("2026-11-18T00:00:00Z", query.path("fromTimestamp").asString())
        assertEquals("2026-11-19T00:00:00Z", query.path("toTimestamp").asString())
        val filters = query.path("filters").values().toList()
        assertEquals("GENERATION", filters.of("type").path("value").asString())
        assertEquals("any of", filters.of("traceId").path("operator").asString())
        assertEquals(listOf("t-1", "t-2"), filters.of("traceId").path("value").values().map { it.asString() })
        assertEquals(listOf("t-1" to "gpt-5", "t-2" to null), usage.map { it.traceId to it.model })
        assertEquals(listOf(120L to 30L, 7L to 3L), usage.map { it.inputTokens to it.outputTokens })
        assertEquals(listOf(0.0125, 0.5), usage.map { it.cost })
    }

    @Test
    fun `usage over a whole window has no trace id filter`() {
        val factory = RecordingRequestFactory { Reply(200, """{"data":[]}""") }

        assertTrue(client(factory).observationUsage(from, to).isEmpty())

        val filters = mapper.readTree(factory.calls.single().query.getValue("query").single()).path("filters").values().toList()
        assertEquals(listOf("type"), filters.map { it.path("column").asString() })
    }

    @Test
    fun `observation groups are one Metrics query over the tagged requests grouped by name level and prompt`() {
        val rows = """{"data":[
            {"name":"decision_guard","level":"DEFAULT","promptName":null,"count_count":"12"},
            {"name":"main_agent","level":"ERROR","promptName":"orchestration.main","count_count":3},
            {"name":"step.world","level":"DEFAULT","promptName":"","count_count":"7"}]}"""
        val factory = RecordingRequestFactory { Reply(200, rows) }

        val groups = client(factory).observationGroups(from, to, listOf("orchestration", "rating"))

        val call = factory.calls.single()
        assertEquals(metrics, call.uri.path)
        val query = mapper.readTree(call.query.getValue("query").single())
        assertEquals("observations", query.path("view").asString())
        assertEquals(listOf("name", "level", "promptName"), query.path("dimensions").values().map { it.path("field").asString() })
        assertEquals(listOf("count" to "count"), query.path("metrics").values().map { it.path("measure").asString() to it.path("aggregation").asString() })
        assertEquals("2026-11-18T00:00:00Z", query.path("fromTimestamp").asString())
        assertEquals("2026-11-19T00:00:00Z", query.path("toTimestamp").asString())
        // The largest row limit: Langfuse's default of 100 rows would cut a long list of names.
        assertEquals(1000, query.path("config").path("row_limit").asInt())
        val tags = query.path("filters").values().toList().single()
        assertEquals(listOf("arrayOptions", "tags", "any of"), listOf(tags.path("type").asString(), tags.path("column").asString(), tags.path("operator").asString()))
        assertEquals(listOf("feature:orchestration", "feature:rating"), tags.path("value").values().map { it.asString() })
        // A count comes as a number or a numeric string, and "no prompt" as null or blank.
        assertEquals(
            listOf(ObservationGroup("decision_guard", "DEFAULT", null, 12), ObservationGroup("main_agent", "ERROR", "orchestration.main", 3), ObservationGroup("step.world", "DEFAULT", null, 7)),
            groups,
        )
    }

    @Test
    fun `observation latencies are the p95 of each name from one Metrics query`() {
        val rows = """{"data":[{"name":"step.world","p95_latency":"1250.5"},{"name":"decision_guard","p95_latency":820},{"name":"main_agent.blocked","p95_latency":null}]}"""
        val factory = RecordingRequestFactory { Reply(200, rows) }

        val latencies = client(factory).observationLatencies(from, to, listOf("orchestration"))

        // A name without a measured latency has no p95: it is left out, never 0.
        assertEquals(mapOf("step.world" to 1250.5, "decision_guard" to 820.0), latencies)
        val query = mapper.readTree(factory.calls.single().query.getValue("query").single())
        assertEquals("observations", query.path("view").asString())
        assertEquals(listOf("name"), query.path("dimensions").values().map { it.path("field").asString() })
        assertEquals(listOf("latency" to "p95"), query.path("metrics").values().map { it.path("measure").asString() to it.path("aggregation").asString() })
        assertEquals(1000, query.path("config").path("row_limit").asInt())
        assertEquals(listOf("feature:orchestration"), query.path("filters").values().single().path("value").values().map { it.asString() })
    }

    @Test
    fun `node records are read by feature tag name and level inside the filter parameter newest first`() {
        val factory = RecordingRequestFactory { call -> Reply(200, if (call.uri.path == metrics) count(41) else page("t1", "t2")) }

        val rows = client(factory).pipelineObservations(from, to, "orchestration", setOf("decision_guard", "decision_guard.generation"), null, "ERROR", 0, 20)

        assertEquals(listOf("o-t1", "o-t2"), rows.items.map { it.path("id").asString() })
        assertEquals(41L, rows.total)
        val (read, total) = factory.calls
        assertEquals(observations, read.uri.path)
        assertEquals(setOf("fields", "filter", "limit"), read.query.keys)
        assertEquals(listOf("20"), read.query["limit"])
        // The bodies, the metadata, the model, the prompt and the latency come with the record.
        assertTrue(read.query.getValue("fields").single().split(",").containsAll(listOf("core", "basic", "io", "metadata", "model", "prompt", "metrics")))
        val all = conditions(read.query.getValue("filter").single())
        val tags = all.of("tags")
        assertEquals(listOf("arrayOptions", "any of", "feature:orchestration"), listOf(tags.path("type").asString(), tags.path("operator").asString(), tags.path("value").values().single().asString()))
        val name = all.of("name")
        assertEquals(listOf("stringOptions", "any of"), listOf(name.path("type").asString(), name.path("operator").asString()))
        assertEquals(listOf("decision_guard", "decision_guard.generation"), name.path("value").values().map { it.asString() })
        val level = all.of("level")
        assertEquals(listOf("string", "=", "ERROR"), listOf(level.path("type").asString(), level.path("operator").asString(), level.path("value").asString()))
        val times = all.filter { it.path("column").asString() == "startTime" }
        assertEquals(listOf(">=", "<"), times.map { it.path("operator").asString() })
        assertEquals(listOf("2026-11-18T00:00:00Z", "2026-11-19T00:00:00Z"), times.map { it.path("value").asString() })
        // The total is a Metrics count over the same conditions; its time bounds are query fields.
        assertEquals(metrics, total.uri.path)
        val counted = mapper.readTree(total.query.getValue("query").single())
        assertEquals(all.filter { it.path("column").asString() != "startTime" }, counted.path("filters").values().toList())
        assertEquals(listOf("2026-11-18T00:00:00Z", "2026-11-19T00:00:00Z"), listOf(counted.path("fromTimestamp").asString(), counted.path("toTimestamp").asString()))
    }

    @Test
    fun `a family of names is read by prefix and later pages skip the newer rows and no name rule at all is refused before any call`() {
        val factory = RecordingRequestFactory { call -> Reply(200, if (call.uri.path == metrics) count(9) else page("t1", "t2", "t3", "t4")) }
        val langfuse = client(factory)

        val rows = langfuse.pipelineObservations(from, to, "orchestration", emptySet(), "mcp.", null, 2, 2)

        assertEquals(listOf("o-t3", "o-t4"), rows.items.map { it.path("id").asString() })
        val read = factory.calls.first { it.uri.path == observations }
        // Four rows are wanted: two passed over and two shown.
        assertEquals(listOf("4"), read.query["limit"])
        val all = conditions(read.query.getValue("filter").single())
        val name = all.of("name")
        assertEquals(listOf("string", "starts with", "mcp."), listOf(name.path("type").asString(), name.path("operator").asString(), name.path("value").asString()))
        assertTrue(all.none { it.path("column").asString() == "level" })
        // An empty name list would narrow nothing and read every observation of the project.
        factory.calls.clear()
        assertThrows(IllegalArgumentException::class.java) { langfuse.pipelineObservations(from, to, "orchestration", emptySet(), null, null, 0, 20) }
        assertTrue(factory.calls.isEmpty())
    }

    @Test
    fun `experiments are read from a start time with their metadata 100 per page up to 500`() {
        val full = """{"data":[${items(100, "e")}],"meta":{"cursor":"more"}}"""
        val factory = RecordingRequestFactory { Reply(200, full) }

        val runs = client(factory).experiments(from, null)

        assertEquals(500, runs.size)
        assertEquals(5, factory.calls.size)
        val first = factory.calls.first()
        assertEquals("/api/public/experiments", first.uri.path)
        // fromStartTime is required: Langfuse answers 400 without it.
        assertEquals(mapOf("fromStartTime" to listOf("2026-11-18T00:00:00Z"), "fields" to listOf("core,metadata"), "limit" to listOf("100")), first.query)
        assertEquals(listOf("more"), factory.calls[1].query["cursor"])
    }

    @Test
    fun `the scores of experiments are read by experiment id with their details and subject`() {
        val factory = RecordingRequestFactory { Reply(200, """{"data":[{"id":"s-1","name":"passed","dataType":"BOOLEAN","value":true,"subject":{"kind":"experiment","id":"e-1"}}],"meta":{"limit":100}}""") }

        val scores = client(factory).experimentScores(listOf("e-1", "e-2"))

        assertEquals(listOf("passed"), scores.map { it.path("name").asString() })
        val call = factory.calls.single()
        assertEquals("/api/public/v3/scores", call.uri.path)
        assertEquals(mapOf("experimentId" to listOf("e-1,e-2"), "fields" to listOf("details,subject"), "limit" to listOf("100")), call.query)
    }

    @Test
    fun `many experiments are scored in chunks of 50 ids and none means no request`() {
        val factory = RecordingRequestFactory { Reply(200, nothing) }
        val langfuse = client(factory)

        // An empty experimentId filter would narrow nothing and read every score of the project.
        assertTrue(langfuse.experimentScores(emptyList()).isEmpty())
        assertTrue(factory.calls.isEmpty())

        langfuse.experimentScores((1..120).map { "e$it" })

        assertEquals(listOf(50, 50, 20), factory.calls.map { it.query.getValue("experimentId").single().split(",").size })
    }

    @Test
    fun `scores page by cursor`() {
        val factory = RecordingRequestFactory { call ->
            Reply(200, if (call.query["cursor"] == null) """{"data":[{"id":"s-1"},{"id":"s-2"}],"meta":{"limit":100,"cursor":"c1"}}""" else """{"data":[{"id":"s-3"}],"meta":{"limit":100}}""")
        }

        val scores = client(factory).experimentScores(listOf("e-1"))

        assertEquals(listOf("s-1", "s-2", "s-3"), scores.map { it.path("id").asString() })
        assertEquals(listOf("c1"), factory.calls[1].query["cursor"])
    }

    @Test
    fun `every Langfuse read uses a v4 endpoint and none of the removed v1 ones`() {
        val factory = RecordingRequestFactory { Reply(200, nothing) }
        val langfuse = client(factory)

        langfuse.traces(from, to, null, null, null, null, 0, 20)
        langfuse.allTraces(from, to)
        langfuse.traceObservations("t-1")
        langfuse.observationUsage(from, to)
        langfuse.experiments(from, null)
        langfuse.experimentScores(listOf("e-1"))
        langfuse.observationGroups(from, to, listOf("orchestration"))
        langfuse.observationLatencies(from, to, listOf("orchestration"))
        langfuse.pipelineObservations(from, to, "orchestration", setOf("main_agent"), null, null, 0, 20)

        // /api/public/traces, /observations, /sessions, /scores, /v2/scores, /metrics and /datasets/{name}/runs answer 404 on a v4 server.
        assertEquals(setOf(observations, metrics, "/api/public/experiments", "/api/public/v3/scores"), factory.calls.map { it.uri.path }.toSet())
    }

    @Test
    fun `prompt calls put names and versions into the path and keep 400 only for writes`() {
        val factory = RecordingRequestFactory { call ->
            when {
                call.method == HttpMethod.POST -> Reply(400, """{"message":"bad prompt"}""")
                else -> Reply(200, """{"name":"qa/answer","version":3,"labels":["latest"]}""")
            }
        }
        val langfuse = client(factory)

        assertEquals(3, langfuse.prompt("qa/answer", 3).path("version").asInt())
        langfuse.setPromptLabels("qa/answer", 3, listOf("production"))
        assertEquals(400, status { langfuse.createPrompt(mapOf("name" to "qa/answer", "type" to "text", "prompt" to "x", "labels" to emptyList<String>())) })

        val read = factory.calls[0]
        assertEquals("/api/public/v2/prompts/qa%2Fanswer", read.uri.rawPath)
        assertEquals(listOf("3"), read.query["version"])
        val patch = factory.calls[1]
        assertEquals(HttpMethod.PATCH, patch.method)
        assertEquals("/api/public/v2/prompts/qa%2Fanswer/versions/3", patch.uri.rawPath)
        assertEquals(listOf("production"), mapper.readTree(patch.body).path("newLabels").values().map { it.asString() })
        val create = factory.calls[2]
        assertEquals("/api/public/v2/prompts", create.uri.path)
        assertEquals("application/json", create.headers.contentType.toString())
        assertEquals("qa/answer", mapper.readTree(create.body).path("name").asString())
        langfuse.prompt("qa/answer", "production")
        assertEquals(listOf("production"), factory.calls[3].query["label"])
        assertEquals(null, factory.calls[3].query["version"])
        assertEquals(404, status { client(RecordingRequestFactory { Reply(404) }).prompt("x", 1) })
        assertEquals(502, status { client(RecordingRequestFactory { Reply(400) }).prompt("x", 1) })
    }

    @Test
    fun `a prompt name filter is a URI variable and list calls page through the results`() {
        val factory = RecordingRequestFactory { Reply(200, """{"data":[{"name":"qa","versions":[1,2]}],"meta":{"totalPages":2}}""") }

        val metas = client(factory).prompts("qa&x")

        assertEquals(2, metas.size)
        assertEquals("/api/public/v2/prompts", factory.calls[0].uri.path)
        assertEquals(listOf("qa&x"), factory.calls[0].query["name"])
        assertEquals(listOf("1", "2"), factory.calls.map { it.query.getValue("page").single() })
        assertEquals(listOf("100"), factory.calls[0].query["limit"])
    }

    @Test
    fun `models are listed and created through the models endpoint`() {
        val factory = RecordingRequestFactory { call ->
            if (call.method == HttpMethod.POST) Reply(200, """{"id":"m-1","modelName":"gpt-5"}""") else Reply(200, """{"data":[{"id":"m-1"}],"meta":{"totalPages":1}}""")
        }
        val langfuse = client(factory)

        assertEquals(1, langfuse.models().size)
        assertEquals("m-1", langfuse.createModel(mapOf("modelName" to "gpt-5", "matchPattern" to "(?i)^gpt-5$", "unit" to "TOKENS")).path("id").asString())

        assertEquals(listOf(HttpMethod.GET, HttpMethod.POST), factory.calls.map { it.method })
        assertEquals(setOf("/api/public/models"), factory.calls.map { it.uri.path }.toSet())
        assertEquals("TOKENS", mapper.readTree(factory.calls[1].body).path("unit").asString())
    }
}
