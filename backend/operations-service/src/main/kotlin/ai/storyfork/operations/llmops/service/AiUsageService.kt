package ai.storyfork.operations.llmops.service

import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.ObservationUsage
import ai.storyfork.operations.llmops.service.dto.MetricRow
import java.time.Instant
import org.springframework.stereotype.Service

private val GROUPINGS = setOf("day", "feature", "model")

/**
 * AI usage figures computed from Langfuse for the metrics screen, the dashboard and the alert checks. The trace list gives status, latency,
 * cost and the credit-reservation metadata; the metrics API adds the token sums. Nothing is cached: every call reads Langfuse again.
 */
@Service
class AiUsageService(private val langfuse: LangfuseClient) {
    internal fun traceFacts(from: Instant, to: Instant): List<TraceFact> = langfuse.allTraces(from, to).map { it.toTraceFact() }

    fun rows(from: Instant, to: Instant, groupBy: String): List<MetricRow> {
        require(groupBy in GROUPINGS) { "Unknown grouping." }
        val facts = traceFacts(from, to)
        if (facts.isEmpty()) return emptyList()
        val usage = langfuse.observationUsage(from, to)
        val byTrace = usage.groupBy { it.traceId }
        return when (groupBy) {
            "day" -> facts.groupBy { it.timestamp.atZone(KST).toLocalDate().toString() }.toSortedMap().map { (key, group) -> traceRow(key, group, byTrace) }
            "feature" -> facts.groupBy { it.feature }.map { (key, group) -> traceRow(key, group, byTrace) }.mostRequestedFirst()
            else -> modelRows(facts, usage).mostRequestedFirst()
        }
    }

    /** A day or feature row: the group's traces give the counts and cost, the usage rows of those traces give the tokens. */
    private fun traceRow(key: String, group: List<TraceFact>, byTrace: Map<String, List<ObservationUsage>>): MetricRow {
        val stats = group.usageStats()
        val usage = group.flatMap { byTrace[it.id].orEmpty() }
        return MetricRow(key, stats.requests, stats.failureRate, stats.timeoutRate, stats.p50LatencyMs, stats.p95LatencyMs,
            usage.sumOf { it.inputTokens }, usage.sumOf { it.outputTokens }, stats.costUser, stats.costPlatform)
    }

    /** A trace that used two models is a request of both; each model row carries only that model's tokens and cost. A usage row of an unknown trace is dropped. */
    private fun modelRows(facts: List<TraceFact>, usage: List<ObservationUsage>): List<MetricRow> {
        val factById = facts.associateBy { it.id }
        return usage.filter { it.traceId in factById }.groupBy { it.model ?: "unknown" }.map { (model, rows) ->
            val stats = rows.map { factById.getValue(it.traceId) }.distinct().usageStats()
            val (charged, platform) = rows.partition { factById.getValue(it.traceId).userCharged }
            MetricRow(model, stats.requests, stats.failureRate, stats.timeoutRate, stats.p50LatencyMs, stats.p95LatencyMs,
                rows.sumOf { it.inputTokens }, rows.sumOf { it.outputTokens }, charged.sumOf { it.cost }, platform.sumOf { it.cost })
        }
    }

    private fun List<MetricRow>.mostRequestedFirst() = sortedWith(compareByDescending<MetricRow> { it.requests }.thenBy { it.key })
}
