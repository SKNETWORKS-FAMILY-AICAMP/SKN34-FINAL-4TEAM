package ai.storyfork.operations._common.client

import java.net.URI
import java.time.Instant
import java.util.concurrent.atomic.AtomicReference
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import org.springframework.web.server.ResponseStatusException
import org.springframework.web.util.UriBuilder
import org.springframework.web.util.UriUtils
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/** Token and cost sums of one trace's generations for one model, read from the metrics API. */
data class ObservationUsage(val traceId: String, val model: String?, val inputTokens: Long, val outputTokens: Long, val cost: Double)

private const val PAGE_SIZE = 100
private const val MAX_TRACE_PAGES = 10
private const val MAX_LIST_PAGES = 5
private const val USAGE_ROW_LIMIT = 1000

/**
 * Langfuse Public API (Basic auth with the project keys, see [langfuseRestClient]). Responses stay [JsonNode]: the services read only the
 * fields a screen needs. Every user-controlled value goes in as a URI variable, so reserved characters can never add or change a parameter.
 * Only a missing record (404) keeps its status on reads, and 400/404/409 on writes; a bad key (401/403) is a 502, not the admin's own 401.
 */
class LangfuseClient(private val http: RestClient, private val uiUrl: String, private val mapper: JsonMapper) {
    private val projectId = AtomicReference<String?>()

    /** One trace page (data, meta). A [requestId] is a metadata filter, which Langfuse only takes in its filter parameter. */
    fun traces(from: Instant?, to: Instant?, tags: List<String>, userId: String?, requestId: String?, page: Int, limit: Int): JsonNode {
        val params = mutableListOf<Pair<String, Any?>>("page" to page, "limit" to limit, "orderBy" to "timestamp.desc")
        if (requestId == null) {
            params += listOf("fromTimestamp" to from?.toString(), "toTimestamp" to to?.toString(), "userId" to userId)
            tags.forEach { params += "tags" to it }
        } else {
            params += "filter" to traceFilter(from, to, tags, userId, requestId)
        }
        return get("/api/public/traces", params = params)
    }

    /** Newest first. ponytail: at most 1,000 traces (10 pages) so a wide window cannot stall a screen; move to server-side metrics aggregation beyond that. */
    fun allTraces(from: Instant, to: Instant): List<JsonNode> {
        val out = mutableListOf<JsonNode>()
        for (page in 1..MAX_TRACE_PAGES) {
            val body = traces(from, to, emptyList(), null, null, page, PAGE_SIZE)
            out += body.path("data").values()
            if (page >= body.path("meta").path("totalPages").asInt(1)) break
        }
        return out
    }

    fun trace(id: String): JsonNode = get("/api/public/traces/{id}", mapOf("id" to id))

    /** Token and cost sums per trace and model over the window; [traceIds] narrows it to one page of traces. */
    fun observationUsage(from: Instant, to: Instant, traceIds: List<String>? = null): List<ObservationUsage> {
        val filters = mutableListOf<Map<String, Any>>(mapOf("column" to "type", "operator" to "=", "value" to "GENERATION", "type" to "string"))
        if (traceIds != null) filters += mapOf("column" to "traceId", "operator" to "any of", "value" to traceIds, "type" to "stringOptions")
        val query = mapOf(
            "view" to "observations",
            "dimensions" to listOf(mapOf("field" to "traceId"), mapOf("field" to "providedModelName")),
            "metrics" to listOf("inputTokens", "outputTokens", "totalCost").map { mapOf("measure" to it, "aggregation" to "sum") },
            "filters" to filters, "fromTimestamp" to from.toString(), "toTimestamp" to to.toString(),
            "config" to mapOf("row_limit" to USAGE_ROW_LIMIT),
        )
        return get("/api/public/metrics", params = listOf("query" to mapper.writeValueAsString(query))).path("data").values().map { row ->
            ObservationUsage(row.path("traceId").asString(), row.path("providedModelName").textOrNull(),
                row.sum("inputTokens").asLong(), row.sum("outputTokens").asLong(), row.sum("totalCost").asDouble())
        }
    }

    /** Prompt metas (name, versions, labels), optionally one name. */
    fun prompts(name: String? = null): List<JsonNode> = pages("/api/public/v2/prompts", params = listOf("name" to name))

    fun prompt(name: String, version: Int): JsonNode =
        get("/api/public/v2/prompts/{name}", mapOf("name" to name), listOf("version" to version))

    fun createPrompt(body: Map<String, Any?>): JsonNode = send(HttpMethod.POST, "/api/public/v2/prompts", emptyMap(), body)

    /** Langfuse keeps labels unique across versions, so this also takes them off any other version. */
    fun setPromptLabels(name: String, version: Int, labels: List<String>): JsonNode =
        send(HttpMethod.PATCH, "/api/public/v2/prompts/{name}/versions/{version}", mapOf("name" to name, "version" to version), mapOf("newLabels" to labels))

    fun models(): List<JsonNode> = pages("/api/public/models")

    fun createModel(body: Map<String, Any?>): JsonNode = send(HttpMethod.POST, "/api/public/models", emptyMap(), body)

    /** Every run of every dataset; a run carries its datasetName and metadata. ponytail: 500 datasets and 500 runs each at most. */
    fun datasetRuns(): List<JsonNode> = pages("/api/public/datasets").flatMap { dataset ->
        pages("/api/public/datasets/{dataset}/runs", mapOf("dataset" to dataset.path("name").asString()))
    }

    /** The Langfuse screen of one trace; the project id is read once (the keys belong to a single project). */
    fun traceUrl(id: String): String = "${uiUrl.trimEnd('/')}/project/${projectId()}/traces/${UriUtils.encodePathSegment(id, Charsets.UTF_8)}"

    private fun projectId(): String = projectId.get() ?: (get("/api/public/projects").path("data").path(0).path("id").textOrNull()
        ?: throw ResponseStatusException(HttpStatus.BAD_GATEWAY)).also { projectId.set(it) }

    private fun traceFilter(from: Instant?, to: Instant?, tags: List<String>, userId: String?, requestId: String): String {
        val conditions = mutableListOf<Map<String, Any>>()
        from?.let { conditions += mapOf("type" to "datetime", "column" to "timestamp", "operator" to ">=", "value" to it.toString()) }
        to?.let { conditions += mapOf("type" to "datetime", "column" to "timestamp", "operator" to "<", "value" to it.toString()) }
        userId?.let { conditions += mapOf("type" to "string", "column" to "userId", "operator" to "=", "value" to it) }
        if (tags.isNotEmpty()) conditions += mapOf("type" to "arrayOptions", "column" to "tags", "operator" to "all of", "value" to tags)
        conditions += mapOf("type" to "stringObject", "column" to "metadata", "key" to "request_id", "operator" to "=", "value" to requestId)
        return mapper.writeValueAsString(conditions)
    }

    /** The aggregate of one measure; the name is "measure_aggregation" or "aggregation_measure" depending on the Langfuse version. */
    private fun JsonNode.sum(measure: String): JsonNode = path("${measure}_sum").takeUnless { it.isMissingNode } ?: path("sum_${measure}")

    private fun pages(path: String, pathVars: Map<String, Any?> = emptyMap(), params: List<Pair<String, Any?>> = emptyList()): List<JsonNode> {
        val out = mutableListOf<JsonNode>()
        for (page in 1..MAX_LIST_PAGES) {
            val body = get(path, pathVars, params + listOf("page" to page, "limit" to PAGE_SIZE))
            out += body.path("data").values()
            if (page >= body.path("meta").path("totalPages").asInt(1)) break
        }
        return out
    }

    private fun get(path: String, pathVars: Map<String, Any?> = emptyMap(), params: List<Pair<String, Any?>> = emptyList()): JsonNode =
        upstream(setOf(404)) { http.get().uri { uri(it, path, pathVars, params) }.retrieve().body(JsonNode::class.java) }

    private fun send(method: HttpMethod, path: String, pathVars: Map<String, Any?>, body: Any): JsonNode = upstream {
        http.method(method).uri { uri(it, path, pathVars, emptyList()) }.contentType(MediaType.APPLICATION_JSON).body(body).retrieve().body(JsonNode::class.java)
    }

    private fun uri(builder: UriBuilder, path: String, pathVars: Map<String, Any?>, params: List<Pair<String, Any?>>): URI {
        builder.path(path)
        val variables = HashMap(pathVars)
        params.filter { it.second != null }.forEachIndexed { index, (name, value) ->
            builder.queryParam(name, "{q$index}")
            variables["q$index"] = value
        }
        return builder.build(variables)
    }
}
