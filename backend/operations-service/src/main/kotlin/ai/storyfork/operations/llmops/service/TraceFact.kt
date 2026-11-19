package ai.storyfork.operations.llmops.service

import ai.storyfork.operations._common.client.doubleOrNull
import ai.storyfork.operations._common.client.textOrNull
import java.time.Instant
import java.time.ZoneId
import kotlin.math.ceil
import kotlin.math.roundToLong
import tools.jackson.databind.JsonNode

/** The service's day: "today" and the day keys of the metrics are Korean days, like the notice dates of Core. */
internal val KST: ZoneId = ZoneId.of("Asia/Seoul")

/** One Langfuse trace reduced to what the screens and checks read. Tags and metadata follow the AI instrumentation rules of the contract. */
internal data class TraceFact(
    val id: String, val timestamp: Instant, val feature: String, val status: String, val latencyMs: Long?, val cost: Double,
    val userId: String?, val workId: String?, val userCharged: Boolean, val fork: Boolean, val output: JsonNode?,
)

internal fun JsonNode.toTraceFact(): TraceFact {
    val tags = path("tags").values().mapNotNull { it.textOrNull() }
    fun tag(prefix: String) = tags.firstOrNull { it.startsWith(prefix) }?.removePrefix(prefix)
    val metadata = path("metadata")
    return TraceFact(
        id = path("id").asString(), timestamp = Instant.parse(path("timestamp").asString()),
        feature = tag("feature:") ?: "unknown", status = tag("status:") ?: "unknown",
        latencyMs = path("latency").doubleOrNull()?.let { (it * 1000).roundToLong() }, cost = path("totalCost").doubleOrNull() ?: 0.0,
        userId = path("userId").textOrNull(), workId = metadata.path("work_id").textOrNull(),
        // The user bears a request's cost exactly when a credit reservation is attached to it.
        userCharged = metadata.path("credit_reservation_id").textOrNull() != null,
        fork = metadata.path("fork").textOrNull().equals("true", ignoreCase = true),
        output = path("output").takeUnless { it.isMissingNode || it.isNull },
    )
}

/** A failed request is status:failed and a timeout is status:timeout, so the two never overlap; the rates divide by all requests. */
internal data class UsageStats(
    val requests: Int, val failed: Int, val timeouts: Int, val costUser: Double, val costPlatform: Double, val p50LatencyMs: Long, val p95LatencyMs: Long,
) {
    val failureRate: Double get() = if (requests == 0) 0.0 else failed.toDouble() / requests
    val timeoutRate: Double get() = if (requests == 0) 0.0 else timeouts.toDouble() / requests
}

internal fun List<TraceFact>.usageStats(): UsageStats {
    val latencies = mapNotNull { it.latencyMs }.sorted()
    // Nearest rank: the smallest latency that at least p of the samples do not exceed.
    fun percentile(p: Double) = if (latencies.isEmpty()) 0L else latencies[(ceil(p * latencies.size).toInt() - 1).coerceAtLeast(0)]
    return UsageStats(
        size, count { it.status == "failed" }, count { it.status == "timeout" },
        filter { it.userCharged }.sumOf { it.cost }, filterNot { it.userCharged }.sumOf { it.cost }, percentile(0.5), percentile(0.95),
    )
}
