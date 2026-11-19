package ai.storyfork.operations.llmops.service

import ai.storyfork.operations._common.client.doubleOrNull
import ai.storyfork.operations._common.client.instant
import ai.storyfork.operations._common.client.instantOrNull
import ai.storyfork.operations._common.client.textOrNull
import java.time.Instant
import java.time.ZoneId
import kotlin.math.ceil
import kotlin.math.roundToLong
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/** The service's day: "today" and the day keys of the metrics are Korean days, like the notice dates of Core. */
internal val KST: ZoneId = ZoneId.of("Asia/Seoul")

/**
 * One request root of Langfuse (a row of the Observations API) reduced to what the screens and checks read, following the AI instrumentation rules of the
 * contract: the root is named after the feature and tagged feature:<key>, its metadata carries request_id, work_id, fork and, once the request has finished,
 * the status. A request that waits for the writer or was cancelled has no [status]. A root has no cost of its own: [cost] and the tokens are those of the
 * trace's generations, joined in by the usage aggregation.
 */
internal data class TraceFact(
    val id: String, val timestamp: Instant, val feature: String, val status: String?, val latencyMs: Long?,
    val userId: String?, val workId: String?, val userCharged: Boolean, val fork: Boolean,
    val cost: Double = 0.0, val inputTokens: Long = 0, val outputTokens: Long = 0,
)

internal fun JsonNode.toTraceFact(): TraceFact {
    val tags = path("tags").values().mapNotNull { it.textOrNull() }
    val metadata = path("metadata")
    return TraceFact(
        id = path("traceId").textOrNull() ?: throw ResponseStatusException(HttpStatus.BAD_GATEWAY), timestamp = path("startTime").instant(),
        feature = tags.firstOrNull { it.startsWith("feature:") }?.removePrefix("feature:") ?: path("name").textOrNull() ?: "unknown",
        status = metadata.path("status").textOrNull(),
        latencyMs = path("latency").doubleOrNull()?.let { (it * 1000).roundToLong() },
        userId = path("userId").textOrNull(), workId = metadata.path("work_id").textOrNull(),
        // The user bears a request's cost exactly when a credit reservation is attached to it.
        userCharged = metadata.path("credit_reservation_id").textOrNull() != null,
        fork = metadata.path("fork").textOrNull().equals("true", ignoreCase = true),
    )
}

private val ioReader = JsonMapper.builder().build()

/**
 * An observation's input or output. The Observations API gives it as raw text: text that is a JSON object or array becomes JSON again (what the screens
 * and the leak check got from the old trace API), any other text stays a string, blank and null are null.
 */
internal fun JsonNode.ioValue(): JsonNode? = when {
    isMissingNode || isNull -> null
    !isString -> this
    stringValue().isBlank() -> null
    stringValue().trimStart().let { it.startsWith("{") || it.startsWith("[") } -> runCatching { ioReader.readTree(stringValue()) }.getOrDefault(this)
    else -> this
}

private fun JsonNode.startedAt(): Instant = path("startTime").instant()

private fun JsonNode.isRoot() = path("isRootObservation").asBoolean(false)

private fun JsonNode.finished() = path("metadata").path("status").textOrNull() != null

/**
 * The request root the trace is shown by: its newest finished request, else its newest root, else its earliest observation. A turn that was resumed has a
 * root per HTTP request, and the ones that waited have no status.
 */
internal fun List<JsonNode>.requestRoot(): JsonNode {
    val roots = filter { it.isRoot() }.sortedByDescending { it.startedAt() }
    return roots.firstOrNull { it.finished() } ?: roots.firstOrNull() ?: minBy { it.startedAt() }
}

/** What the trace was asked: its request root's input, else that of the earliest observation that has one. */
internal fun List<JsonNode>.traceInput(): JsonNode? = if (isEmpty()) null else
    requestRoot().path("input").ioValue() ?: sortedBy { it.startedAt() }.firstNotNullOfOrNull { it.path("input").ioValue() }

/** What it answered: its request root's output, else that of the model call that ended last and has one. */
internal fun List<JsonNode>.traceOutput(): JsonNode? = if (isEmpty()) null else
    requestRoot().path("output").ioValue() ?: filter { it.path("type").textOrNull() == "GENERATION" }
        .sortedBy { it.path("endTime").instantOrNull() ?: it.startedAt() }.asReversed().firstNotNullOfOrNull { it.path("output").ioValue() }

/**
 * A finished request is a root that carries a status; the others are not counted as requests. What needs a finished request to mean anything is null
 * without one, "no data", never a 0% rate or a 0 ms latency: the rates, and the latency percentiles (which also need a measured latency).
 */
internal data class UsageStats(
    val requests: Int, val failed: Int, val timeouts: Int, val costUser: Double, val costPlatform: Double, val p50LatencyMs: Long?, val p95LatencyMs: Long?,
) {
    val failureRate: Double? get() = if (requests == 0) null else failed.toDouble() / requests
    val timeoutRate: Double? get() = if (requests == 0) null else timeouts.toDouble() / requests
}

/** A failed request is status:failed and a timeout is status:timeout, so the two never overlap; the rates divide by all finished requests. */
internal fun List<TraceFact>.usageStats(): UsageStats {
    val requests = filter { it.status != null }
    val latencies = requests.mapNotNull { it.latencyMs }.sorted()
    // Nearest rank: the smallest latency that at least p of the samples do not exceed.
    fun percentile(p: Double) = if (latencies.isEmpty()) null else latencies[(ceil(p * latencies.size).toInt() - 1).coerceAtLeast(0)]
    // The cost counts every root: the model calls of a request that waits for the writer or was cancelled were paid for too.
    return UsageStats(
        requests.size, requests.count { it.status == "failed" }, requests.count { it.status == "timeout" },
        filter { it.userCharged }.sumOf { it.cost }, filterNot { it.userCharged }.sumOf { it.cost }, percentile(0.5), percentile(0.95),
    )
}
