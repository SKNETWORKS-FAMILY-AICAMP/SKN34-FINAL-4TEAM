package ai.storyfork.operations._common.client

import java.net.URI
import java.time.Instant
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import org.springframework.web.util.UriBuilder
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/** Token and cost sums of one trace's generations for one model, read from the metrics API. */
data class ObservationUsage(val traceId: String, val model: String?, val inputTokens: Long, val outputTokens: Long, val cost: Double)

/** One page of observations, newest first (a root per trace for the trace list, the observations of a node for the pipeline), and how many match in all. */
class TraceRoots(val items: List<JsonNode>, val total: Long)

/** How many observations carry one name at one level under one prompt (the prompt of the model call, if any). */
data class ObservationGroup(val name: String, val level: String, val promptName: String?, val count: Long)

private const val PAGE_SIZE = 100
private const val MAX_LIST_PAGES = 5
private const val USAGE_ROW_LIMIT = 1000

/**
 * ponytail: a read sees the newest 1,000 request roots at most (the largest page of the Observations API) so a wide window cannot stall a screen;
 * narrow the window to see older ones, or move to server-side aggregation with the Metrics API.
 */
internal const val MAX_TRACES = 1000
private const val OBSERVATION_PAGE = 1000
private const val MAX_TRACE_OBSERVATIONS = 1000

/** Experiments and Scores v3 pages are 100 at most. */
private const val CURSOR_PAGE = 100
private const val MAX_EXPERIMENTS = 500
private const val MAX_SCORES = 1000

/** The gate sets have 24 and 46 items. */
private const val MAX_EXPERIMENT_ITEMS = 100

/** Experiment ids per scores request, so the URL stays short. */
private const val SCORE_ID_CHUNK = 50

/** A cursor page can come back empty while it still has a cursor; this many requests is the most a single read makes. */
private const val MAX_REQUESTS = 20

/** What Langfuse itself assumes when a read has no lower time bound. */
private val EARLIEST = Instant.parse("2020-01-01T00:00:00Z")

/** The tags and the trace name only come back with trace_context. */
private const val ROOT_FIELDS = "core,basic,metadata,metrics,trace_context"
private const val DETAIL_FIELDS = "core,basic,io,metadata,model,usage,prompt,metrics,trace_context"

private fun condition(type: String, column: String, operator: String, value: Any?, key: String? = null): Map<String, Any?> =
    listOfNotNull("type" to type, "column" to column, key?.let { "key" to it }, "operator" to operator, "value" to value).toMap()

private val ROOT = condition("boolean", "isRootObservation", "=", true)

/** Every observation of a request carries the tag feature:<key> of that request (the AI service tracing), so the tag says which request an observation is in. */
private fun featureTag(keys: List<String>) = condition("arrayOptions", "tags", "any of", keys.map { "feature:$it" })

private fun window(from: Instant?, to: Instant?) =
    listOfNotNull(from?.let { condition("datetime", "startTime", ">=", it.toString()) }, to?.let { condition("datetime", "startTime", "<", it.toString()) })

/**
 * Langfuse Public API (Basic auth with the project keys, see [langfuseRestClient]): the v4 read APIs (Observations v2, Metrics v2, Experiments, Scores v3;
 * the traces, sessions, v1 metrics and dataset-run endpoints answer 404 there). Responses stay [JsonNode]: the services read only the fields a screen
 * needs. Every user-controlled value goes in as a URI variable, so reserved characters can never add or change a parameter. A 404 on a prompt read is a
 * missing record and keeps its status, and 400/404/409 on writes; every other failure, a 404 of the v4 read APIs included (it means a server or URL
 * that does not serve them), and a bad key (401/403) is a 502, not the admin's own 401.
 */
class LangfuseClient(private val http: RestClient, private val mapper: JsonMapper) {
    /**
     * One page of the requests that have finished, a line per trace. A request has finished when its root carries a metadata status (a waiting or cancelled
     * one has none) and a resumed turn has a root per HTTP request, so roots of one trace are merged into the newest. [skip] traces are passed over: the
     * Observations API only walks forward by cursor. Every filter, the window included, goes inside the one filter parameter, which Langfuse lets win over
     * the plain ones. ponytail: [TraceRoots.total] counts roots, so a trace with two finished requests counts twice in it.
     */
    fun traces(from: Instant?, to: Instant?, feature: String?, status: String?, userId: String?, requestId: String?, skip: Int, limit: Int): TraceRoots {
        val conditions = traceConditions(feature, status, userId, requestId)
        val wanted = minOf(skip + limit, MAX_TRACES)
        val roots = cursorPages("/api/public/v2/observations", listOf("fields" to ROOT_FIELDS, "filter" to mapper.writeValueAsString(conditions + window(from, to))), OBSERVATION_PAGE) {
            wanted - it.distinctBy { root -> root.path("traceId").asString() }.size
        }
        val items = roots.distinctBy { it.path("traceId").asString() }.drop(skip).take(limit)
        return TraceRoots(items, count(conditions, from ?: EARLIEST, to ?: Instant.now()))
    }

    /** Every request root of the window, finished or not, newest first. Their generations cost money whatever became of the request. */
    fun allTraces(from: Instant, to: Instant): List<JsonNode> =
        cursorPages("/api/public/v2/observations", listOf("fields" to ROOT_FIELDS, "filter" to mapper.writeValueAsString(listOf(ROOT) + window(from, to))), OBSERVATION_PAGE) {
            MAX_TRACES - it.size
        }

    /** Every observation of one trace, its roots and all steps, in no fixed order; empty when Langfuse has no such trace. */
    fun traceObservations(id: String): List<JsonNode> =
        cursorPages("/api/public/v2/observations", listOf("fields" to DETAIL_FIELDS, "filter" to mapper.writeValueAsString(listOf(condition("string", "traceId", "=", id)))), OBSERVATION_PAGE) {
            MAX_TRACE_OBSERVATIONS - it.size
        }

    /**
     * How many observations carry each name, level and prompt in the requests tagged feature:<key> (any of [features]) over the window. The Metrics API groups
     * them, so the counts are exact however many observations there are. ponytail: Langfuse answers 1,000 groups at most (names x levels x prompts).
     */
    fun observationGroups(from: Instant, to: Instant, features: List<String>): List<ObservationGroup> =
        featureMetrics(from, to, features, listOf("name", "level", "promptName"), "count", "count").values().map { row ->
            ObservationGroup(row.path("name").asString(), row.path("level").textOrNull() ?: "DEFAULT", row.path("promptName").textOrNull(), row.path("count_count").doubleOrNull()?.toLong() ?: 0)
        }

    /** The p95 latency in milliseconds of each observation name over the same requests; a name with no measured latency is left out, never 0. */
    fun observationLatencies(from: Instant, to: Instant, features: List<String>): Map<String, Double> =
        featureMetrics(from, to, features, listOf("name"), "latency", "p95").values()
            .mapNotNull { row -> row.path("p95_latency").doubleOrNull()?.let { row.path("name").asString() to it } }.toMap()

    /**
     * A page of the observations a pipeline node owns, newest first: those of the requests tagged feature:<[feature]> whose name is one of [names] or starts with
     * [prefix], and has [level] if given. One of [names] and [prefix] is required, since an empty name list would narrow nothing and read every observation.
     * [skip] observations are passed over like for traces (the Observations API only walks forward by cursor), so only the newest 1,000 are reachable.
     */
    fun pipelineObservations(from: Instant, to: Instant, feature: String, names: Set<String>, prefix: String?, level: String?, skip: Int, limit: Int): TraceRoots {
        require(prefix != null || names.isNotEmpty()) { "A node owns no observation name." }
        val conditions = listOfNotNull(
            featureTag(listOf(feature)),
            if (prefix != null) condition("string", "name", "starts with", prefix) else condition("stringOptions", "name", "any of", names.toList()),
            level?.let { condition("string", "level", "=", it) },
        )
        val wanted = minOf(skip + limit, MAX_TRACES)
        val rows = cursorPages("/api/public/v2/observations", listOf("fields" to DETAIL_FIELDS, "filter" to mapper.writeValueAsString(conditions + window(from, to))), OBSERVATION_PAGE) {
            wanted - it.size
        }
        return TraceRoots(rows.drop(skip).take(limit), count(conditions, from, to))
    }

    /**
     * Token and cost sums per trace and model over the window; [traceIds] narrows it to one page of traces. Langfuse groups by a trace id only when the rows
     * are limited and ordered by a measure, biggest first, and otherwise answers 400 (its OpenAPI text still calls the trace id unsupported).
     */
    fun observationUsage(from: Instant, to: Instant, traceIds: List<String>? = null): List<ObservationUsage> {
        val filters = mutableListOf(condition("string", "type", "=", "GENERATION"))
        if (traceIds != null) filters += condition("stringOptions", "traceId", "any of", traceIds)
        val query = mapOf(
            "view" to "observations",
            "dimensions" to listOf(mapOf("field" to "traceId"), mapOf("field" to "providedModelName")),
            "metrics" to listOf("inputTokens", "outputTokens", "totalCost").map { mapOf("measure" to it, "aggregation" to "sum") },
            "filters" to filters, "fromTimestamp" to from.toString(), "toTimestamp" to to.toString(),
            "orderBy" to listOf(mapOf("field" to "sum_totalCost", "direction" to "desc")),
            "config" to mapOf("row_limit" to USAGE_ROW_LIMIT),
        )
        return metrics(query).values().map { row ->
            ObservationUsage(row.path("traceId").asString(), row.path("providedModelName").textOrNull(),
                row.path("sum_inputTokens").asLong(), row.path("sum_outputTokens").asLong(), row.path("sum_totalCost").asDouble())
        }
    }

    /** Prompt metas (name, versions, labels), optionally one name. */
    fun prompts(name: String? = null): List<JsonNode> = pages("/api/public/v2/prompts", params = listOf("name" to name))

    fun prompt(name: String, version: Int): JsonNode =
        get("/api/public/v2/prompts/{name}", mapOf("name" to name), listOf("version" to version))

    /** The version carrying the label (production, seed). */
    fun prompt(name: String, label: String): JsonNode =
        get("/api/public/v2/prompts/{name}", mapOf("name" to name), listOf("label" to label))

    fun createPrompt(body: Map<String, Any?>): JsonNode = send(HttpMethod.POST, "/api/public/v2/prompts", emptyMap(), body)

    /** Langfuse keeps labels unique across versions, so this also takes them off any other version. */
    fun setPromptLabels(name: String, version: Int, labels: List<String>): JsonNode =
        send(HttpMethod.PATCH, "/api/public/v2/prompts/{name}/versions/{version}", mapOf("name" to name, "version" to version), mapOf("newLabels" to labels))

    fun models(): List<JsonNode> = pages("/api/public/models")

    fun createModel(body: Map<String, Any?>): JsonNode = send(HttpMethod.POST, "/api/public/models", emptyMap(), body)

    /**
     * The experiments (what a Dataset Run is on v4) that started or had events since [from], newest activity first, with their metadata; [name] narrows it to
     * the experiments of that exact name. Langfuse requires the start time. ponytail: the newest 500 at most.
     */
    fun experiments(from: Instant, name: String?): List<JsonNode> = cursorPages(
        "/api/public/experiments", listOf("fromStartTime" to from.toString(), "fields" to "core,metadata", "name" to name), CURSOR_PAGE,
    ) { MAX_EXPERIMENTS - it.size }

    /**
     * The scores attached to the experiments themselves, which is where the AI service writes a run's verdict and metric averages, with their details and the
     * subject that says which experiment each belongs to. An empty id list is no request: an empty filter would read every score of the project.
     */
    fun experimentScores(experimentIds: List<String>): List<JsonNode> = experimentIds.chunked(SCORE_ID_CHUNK).flatMap { ids ->
        cursorPages("/api/public/v3/scores", listOf("experimentId" to ids.joinToString(","), "fields" to "details,subject"), CURSOR_PAGE) { MAX_SCORES - it.size }
    }

    /**
     * The items of one experiment (a Dataset Run) with their item scores, from the Experiments items API: the only v4 route to a run's items (the dataset-run-items
     * read answers 404 there). [from] bounds the item start time, which Langfuse requires. ponytail: the first 100 items, which is every item of a gate set.
     */
    fun experimentItems(experimentId: String, from: Instant): List<JsonNode> = cursorPages(
        "/api/public/experiment-items", listOf("experimentId" to experimentId, "fromStartTime" to from.toString(), "fields" to "core,scores"), CURSOR_PAGE,
    ) { MAX_EXPERIMENT_ITEMS - it.size }

    /** The conditions of the requests that count: finished ones (a status is set, or is the one asked for) and the filters of the screen. */
    private fun traceConditions(feature: String?, status: String?, userId: String?, requestId: String?): List<Map<String, Any?>> = listOfNotNull(
        ROOT,
        if (status == null) condition("stringObject", "metadata", "is set", "", "status") else condition("stringObject", "metadata", "=", status, "status"),
        feature?.let { featureTag(listOf(it)) },
        userId?.let { condition("string", "userId", "=", it) },
        requestId?.let { condition("stringObject", "metadata", "=", it, "request_id") },
    )

    /** How many roots match, from the metrics API: the Observations API has no total. */
    private fun count(conditions: List<Map<String, Any?>>, from: Instant, to: Instant): Long = metrics(mapOf(
        "view" to "observations", "metrics" to listOf(mapOf("measure" to "count", "aggregation" to "count")),
        "filters" to conditions, "fromTimestamp" to from.toString(), "toTimestamp" to to.toString(),
    )).values().firstOrNull()?.path("count_count")?.doubleOrNull()?.toLong() ?: 0L

    /** One Metrics API v2 aggregate, grouped by [dimensions], over the observations of the requests tagged feature:<key> (any of [features]). */
    private fun featureMetrics(from: Instant, to: Instant, features: List<String>, dimensions: List<String>, measure: String, aggregation: String): JsonNode = metrics(mapOf(
        "view" to "observations", "dimensions" to dimensions.map { mapOf("field" to it) }, "metrics" to listOf(mapOf("measure" to measure, "aggregation" to aggregation)),
        "filters" to listOf(featureTag(features)), "fromTimestamp" to from.toString(), "toTimestamp" to to.toString(), "config" to mapOf("row_limit" to USAGE_ROW_LIMIT),
    ))

    private fun metrics(query: Map<String, Any?>): JsonNode =
        get("/api/public/v2/metrics", params = listOf("query" to mapper.writeValueAsString(query)), missing = emptySet()).path("data")

    /**
     * Reads a cursor-paged list (Observations v2, Experiments, Scores v3): the last page has no cursor in its meta, and a page can be short or even empty
     * while it still has one. [need] says how many more rows are wanted for what has been read so far (nothing more when it is 0 or less); no request asks
     * for more than [pageSize].
     */
    private fun cursorPages(path: String, params: List<Pair<String, Any?>>, pageSize: Int, need: (List<JsonNode>) -> Int): List<JsonNode> {
        val rows = mutableListOf<JsonNode>()
        var cursor: String? = null
        repeat(MAX_REQUESTS) {
            val wanted = need(rows)
            if (wanted <= 0) return rows
            val body = get(path, params = params + listOf("limit" to minOf(wanted, pageSize), "cursor" to cursor), missing = emptySet())
            rows += body.path("data").values()
            cursor = body.path("meta").path("cursor").textOrNull() ?: return rows
        }
        return rows
    }

    private fun pages(
        path: String, pathVars: Map<String, Any?> = emptyMap(), params: List<Pair<String, Any?>> = emptyList(), maxPages: Int = MAX_LIST_PAGES,
    ): List<JsonNode> {
        val out = mutableListOf<JsonNode>()
        for (page in 1..maxPages) {
            val body = get(path, pathVars, params + listOf("page" to page, "limit" to PAGE_SIZE))
            out += body.path("data").values()
            if (page >= body.path("meta").path("totalPages").asInt(1)) break
        }
        return out
    }

    /** [missing] are the statuses that mean "no such record" and are kept: only prompt reads have such a record. */
    private fun get(
        path: String, pathVars: Map<String, Any?> = emptyMap(), params: List<Pair<String, Any?>> = emptyList(), missing: Set<Int> = setOf(404),
    ): JsonNode = upstream(missing) { http.get().uri { uri(it, path, pathVars, params) }.retrieve().body(JsonNode::class.java) }

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
