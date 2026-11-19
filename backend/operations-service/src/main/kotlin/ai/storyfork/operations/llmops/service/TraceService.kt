package ai.storyfork.operations.llmops.service

import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.MAX_TRACES
import ai.storyfork.operations._common.client.ObservationUsage
import ai.storyfork.operations._common.client.doubleOrNull
import ai.storyfork.operations._common.client.instantOrNull
import ai.storyfork.operations._common.client.textOrNull
import ai.storyfork.operations.llmops.service.dto.TraceDetail
import ai.storyfork.operations.llmops.service.dto.TraceItem
import ai.storyfork.operations.llmops.service.dto.TraceObservation
import ai.storyfork.operations.llmops.service.dto.TracePage
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import java.time.Duration
import java.time.Instant
import org.springframework.stereotype.Service
import tools.jackson.databind.JsonNode

private const val LLM = "llm"
private const val PAGE_SIZE = 20
private val STATUSES = setOf("success", "failed", "timeout")

/** What a screen shows for a trace that has no finished request (it waits for the writer or was cancelled). */
private const val UNKNOWN = "unknown"

/**
 * A resumed turn's first generations are older than its last request. ponytail: the usage of a page is read from a week before its oldest line; a turn
 * resumed after a longer wait shows only the usage since then.
 */
private val USAGE_LOOKBACK = Duration.ofDays(7)

/** Trace list and detail for llm admins, read from Langfuse on every call. Permission is checked before any input or Langfuse call. */
@Service
class TraceService(private val permissions: AdminPermissionRepository, private val langfuse: LangfuseClient) {
    /**
     * [page] starts at 0 and the size is fixed at 20; a [requestId] matches the root metadata request_id. A line is a trace that has a finished request,
     * shown by its newest one. ponytail: only the newest 1,000 traces are reachable by paging; narrow the window or the filters to see older ones.
     */
    fun list(member: OperationsMember, from: Instant?, to: Instant?, feature: String?, status: String?, userId: String?, requestId: String?, page: Int): TracePage {
        permissions.requirePermission(member, LLM)
        require(page >= 0 && (page + 1) * PAGE_SIZE <= MAX_TRACES) { "Invalid page." }
        val statusFilter = status.blankToNull()
        require(statusFilter == null || statusFilter in STATUSES) { "Unknown status." }
        val roots = langfuse.traces(from, to, feature.blankToNull(), statusFilter, userId.blankToNull(), requestId.blankToNull(), page * PAGE_SIZE, PAGE_SIZE)
        val facts = roots.items.map { it.toTraceFact() }
        // One usage query for the whole page, narrowed to its trace ids.
        val usage = if (facts.isEmpty()) emptyMap()
        else langfuse.observationUsage(facts.minOf { it.timestamp }.minus(USAGE_LOOKBACK), Instant.now(), facts.map { it.id }).groupBy { it.traceId }
        return TracePage(facts.map { it.item(usage[it.id].orEmpty()) }, page, PAGE_SIZE, roots.total)
    }

    /** The trace-level fields are those of the request root ([requestRoot]); tokens and cost add up the model calls of all the requests of the trace. */
    fun detail(member: OperationsMember, id: String): TraceDetail {
        permissions.requirePermission(member, LLM)
        val nodes = langfuse.traceObservations(id).sortedWith(compareBy(nullsLast<Instant>()) { it.path("startTime").instantOrNull() })
        if (nodes.isEmpty()) throw NoSuchElementException("Trace not found.")
        val fact = nodes.requestRoot().toTraceFact()
        val observations = nodes.map { it.observation() }
        return TraceDetail(
            fact.id, fact.timestamp, fact.feature, fact.status ?: UNKNOWN, fact.latencyMs ?: 0, observations.sumOf { it.inputTokens ?: 0L },
            observations.sumOf { it.outputTokens ?: 0L }, nodes.sumOf { it.path("totalCost").doubleOrNull() ?: 0.0 }, fact.userId, fact.workId,
            nodes.traceInput(), nodes.traceOutput(), observations,
        )
    }

    private fun TraceFact.item(usage: List<ObservationUsage>) = TraceItem(
        id, timestamp, feature, status ?: UNKNOWN, latencyMs ?: 0, usage.sumOf { it.inputTokens }, usage.sumOf { it.outputTokens }, usage.sumOf { it.cost }, userId, workId,
    )

    private fun JsonNode.observation(): TraceObservation {
        val start = path("startTime").instantOrNull()
        val end = path("endTime").instantOrNull()
        return TraceObservation(
            path("id").asString(), path("name").textOrNull() ?: "", path("type").textOrNull() ?: "SPAN", start, end,
            if (start != null && end != null) Duration.between(start, end).toMillis() else 0, path("model").textOrNull(),
            path("usageDetails").path("input").takeIf { it.isNumber }?.asLong(), path("usageDetails").path("output").takeIf { it.isNumber }?.asLong(),
            path("level").textOrNull() ?: "DEFAULT", path("statusMessage").textOrNull(), path("promptName").textOrNull(),
            path("promptVersion").takeIf { it.isNumber }?.asInt(),
        )
    }

    private fun String?.blankToNull() = this?.trim()?.takeIf { it.isNotEmpty() }
}
