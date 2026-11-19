package ai.storyfork.operations._common

import ai.storyfork.operations._common.client.LangfuseClient
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
    private val empty = """{"data":[],"meta":{"page":1,"limit":20,"totalItems":0,"totalPages":0}}"""
    private val from = Instant.parse("2026-11-18T00:00:00Z")
    private val to = Instant.parse("2026-11-19T00:00:00Z")

    private fun client(factory: RecordingRequestFactory) = LangfuseClient(
        langfuseRestClient("http://langfuse.test", "pk-lf-1", "sk-lf-2", mapper).requestFactory(factory).build(), mapper,
    )

    private fun status(call: () -> Unit) = assertThrows(ResponseStatusException::class.java) { call() }.statusCode.value()

    private fun conditions(filter: String): List<JsonNode> = mapper.readTree(filter).values().toList()

    private fun List<JsonNode>.of(column: String) = single { it.path("column").asString() == column }

    @Test
    fun `requests carry the project keys as Basic auth and never the operations service token`() {
        val factory = RecordingRequestFactory { Reply(200, empty) }

        client(factory).traces(null, null, emptyList(), null, null, 1, 20)

        val call = factory.calls.single()
        assertEquals("Basic " + Base64.getEncoder().encodeToString("pk-lf-1:sk-lf-2".toByteArray()), call.headers.getFirst("Authorization"))
        assertNull(call.headers.getFirst("X-Operations-Service-Token"))
        assertEquals(HttpMethod.GET, call.method)
        assertEquals("/api/public/traces", call.uri.path)
        assertEquals(mapOf("page" to listOf("1"), "limit" to listOf("20"), "orderBy" to listOf("timestamp.desc")), call.query)
    }

    @Test
    fun `a trace list sends the window user and every tag as separate Langfuse parameters`() {
        val factory = RecordingRequestFactory { Reply(200, empty) }

        client(factory).traces(from, to, listOf("feature:qa", "status:failed"), "user-1", null, 2, 20)

        val query = factory.calls.single().query
        assertEquals(listOf("2"), query["page"])
        assertEquals(listOf("2026-11-18T00:00:00Z"), query["fromTimestamp"])
        assertEquals(listOf("2026-11-19T00:00:00Z"), query["toTimestamp"])
        assertEquals(listOf("user-1"), query["userId"])
        assertEquals(listOf("feature:qa", "status:failed"), query["tags"])
        assertNull(query["filter"])
    }

    @Test
    fun `a request id travels as a metadata filter and carries the other filters inside it`() {
        val factory = RecordingRequestFactory { Reply(200, empty) }

        client(factory).traces(from, to, listOf("feature:qa"), "user-1", "req-9", 1, 20)

        val query = factory.calls.single().query
        // Langfuse lets the filter parameter take precedence over the plain ones, so nothing may be left outside it.
        assertNull(query["fromTimestamp"])
        assertNull(query["toTimestamp"])
        assertNull(query["userId"])
        assertNull(query["tags"])
        val all = conditions(query.getValue("filter").single())
        val request = all.of("metadata")
        assertEquals("stringObject", request.path("type").asString())
        assertEquals("request_id", request.path("key").asString())
        assertEquals("=", request.path("operator").asString())
        assertEquals("req-9", request.path("value").asString())
        assertEquals("user-1", all.of("userId").path("value").asString())
        assertEquals(listOf("feature:qa"), all.of("tags").path("value").values().map { it.asString() })
        assertEquals("all of", all.of("tags").path("operator").asString())
        assertEquals(listOf(">=", "<"), all.filter { it.path("column").asString() == "timestamp" }.map { it.path("operator").asString() })
        assertEquals(listOf("2026-11-18T00:00:00Z", "2026-11-19T00:00:00Z"), all.filter { it.path("column").asString() == "timestamp" }.map { it.path("value").asString() })
    }

    @Test
    fun `a request id alone still makes a valid filter`() {
        val factory = RecordingRequestFactory { Reply(200, empty) }

        client(factory).traces(null, null, emptyList(), null, "req-9", 1, 20)

        assertEquals(listOf("metadata"), conditions(factory.calls.single().query.getValue("filter").single()).map { it.path("column").asString() })
    }

    @Test
    fun `user input is a URI variable so reserved characters cannot add or change parameters`() {
        val factory = RecordingRequestFactory { Reply(200, empty) }
        val hostile = "a&page=9=c+d/é #x"

        client(factory).traces(null, null, listOf("feature:$hostile"), hostile, null, 1, 20)
        client(factory).traces(null, null, emptyList(), null, hostile, 1, 20)

        val plain = factory.calls[0]
        assertEquals(listOf("1"), plain.query["page"])
        assertEquals(listOf(hostile), plain.query["userId"])
        assertEquals(listOf("feature:$hostile"), plain.query["tags"])
        assertTrue(plain.uri.rawQuery.contains("userId=a%26page%3D9%3Dc%2Bd%2F%C3%A9%20%23x"), plain.uri.rawQuery)
        val filter = factory.calls[1]
        assertEquals(listOf("1"), filter.query["page"])
        assertEquals(hostile, conditions(filter.query.getValue("filter").single()).single().path("value").asString())
    }

    @Test
    fun `all traces are read page by page up to the cap`() {
        val full = """{"data":[{"id":"t"}],"meta":{"page":1,"limit":100,"totalItems":300,"totalPages":3}}"""
        val factory = RecordingRequestFactory { Reply(200, full) }
        val items = client(factory).allTraces(from, to)

        assertEquals(3, factory.calls.size)
        assertEquals(listOf("1", "2", "3"), factory.calls.map { it.query.getValue("page").single() })
        assertEquals(setOf("100"), factory.calls.map { it.query.getValue("limit").single() }.toSet())
        assertEquals(setOf("2026-11-18T00:00:00Z"), factory.calls.map { it.query.getValue("fromTimestamp").single() }.toSet())
        assertEquals(3, items.size)

        val endless = RecordingRequestFactory { Reply(200, """{"data":[{"id":"t"}],"meta":{"totalPages":500}}""") }
        assertEquals(10, client(endless).allTraces(from, to).size)
        assertEquals(10, endless.calls.size)
    }

    @Test
    fun `a missing trace stays 404 and every other failure including bad keys is 502`() {
        for ((upstream, expected) in listOf(404 to 404, 401 to 502, 403 to 502, 400 to 502, 500 to 502, 503 to 502)) {
            val factory = RecordingRequestFactory { Reply(upstream, """{"message":"x"}""") }
            assertEquals(expected, status { client(factory).trace("t-1") }, upstream.toString())
        }
        assertEquals(502, status { client(RecordingRequestFactory { Reply(200, "not-json") }).trace("t-1") })
        assertEquals(502, status { client(RecordingRequestFactory { Reply(200, "") }).trace("t-1") })
    }

    @Test
    fun `a trace detail is read by its id as a URI variable`() {
        val factory = RecordingRequestFactory { Reply(200, """{"id":"a/b c","observations":[]}""") }

        assertEquals("a/b c", client(factory).trace("a/b c").path("id").asString())

        assertEquals("/api/public/traces/a%2Fb%20c", factory.calls.single().uri.rawPath)
    }

    @Test
    fun `token usage is one metrics query over generations grouped by trace and model`() {
        val rows = """{"data":[
            {"traceId":"t-1","providedModelName":"gpt-5","inputTokens_sum":"120","outputTokens_sum":"30","totalCost_sum":0.0125},
            {"traceId":"t-2","providedModelName":null,"sum_inputTokens":7,"sum_outputTokens":"3","sum_totalCost":"0.5"}]}"""
        val factory = RecordingRequestFactory { Reply(200, rows) }

        val usage = client(factory).observationUsage(from, to, listOf("t-1", "t-2"))

        val call = factory.calls.single()
        assertEquals("/api/public/metrics", call.uri.path)
        val query = mapper.readTree(call.query.getValue("query").single())
        assertEquals("observations", query.path("view").asString())
        assertEquals(listOf("traceId", "providedModelName"), query.path("dimensions").values().map { it.path("field").asString() })
        assertEquals(listOf("inputTokens", "outputTokens", "totalCost"), query.path("metrics").values().map { it.path("measure").asString() })
        assertEquals(setOf("sum"), query.path("metrics").values().map { it.path("aggregation").asString() }.toSet())
        assertEquals("2026-11-18T00:00:00Z", query.path("fromTimestamp").asString())
        assertEquals("2026-11-19T00:00:00Z", query.path("toTimestamp").asString())
        assertEquals(1000, query.path("config").path("row_limit").asInt())
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

    @Test
    fun `dataset runs are the runs of every dataset`() {
        val factory = RecordingRequestFactory { call ->
            when (call.uri.rawPath) {
                "/api/public/datasets" -> Reply(200, """{"data":[{"name":"qa regression"},{"name":"leak"}],"meta":{"totalPages":1}}""")
                "/api/public/datasets/qa%20regression/runs" -> Reply(200, """{"data":[{"name":"run-1","datasetName":"qa regression"}],"meta":{"totalPages":1}}""")
                "/api/public/datasets/leak/runs" -> Reply(200, """{"data":[{"name":"run-2","datasetName":"leak"},{"name":"run-3","datasetName":"leak"}],"meta":{"totalPages":1}}""")
                else -> Reply(404)
            }
        }

        val runs = client(factory).datasetRuns()

        assertEquals(listOf("run-1", "run-2", "run-3"), runs.map { it.path("name").asString() })
        assertEquals(3, factory.calls.size)
    }
}
