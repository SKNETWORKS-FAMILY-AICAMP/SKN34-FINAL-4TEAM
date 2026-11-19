package ai.storyfork.operations.llmops.service

import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.ObservationUsage
import ai.storyfork.operations.llmops.service.dto.MetricRow
import java.time.Instant
import org.springframework.stereotype.Service

private val GROUPINGS = setOf("day", "feature", "model")

/**
 * AI usage figures computed from Langfuse for the metrics screen, the dashboard and the alert checks. The request roots give status, latency and the
 * credit-reservation metadata; the metrics API adds the tokens and cost of the generations of each trace. Nothing is cached: every call reads Langfuse again.
 */
@Service
class AiUsageService(private val langfuse: LangfuseClient) {
    internal fun traceFacts(from: Instant, to: Instant): List<TraceFact> = window(from, to).first

    /**
     * The roots of a window, each with the tokens and cost of its trace, and the usage rows of the window's generations. A resumed turn has a root per HTTP
     * request but one set of generations, which must be counted once: with the trace's newest finished root (else its newest root), so a request that waits
     * for the writer adds no request of its own and still keeps the cost of its model calls.
     */
    private fun window(from: Instant, to: Instant): Pair<List<TraceFact>, List<ObservationUsage>> {
        val roots = langfuse.allTraces(from, to).map { it.toTraceFact() }
        if (roots.isEmpty()) return emptyList<TraceFact>() to emptyList()
        val usage = langfuse.observationUsage(from, to)
        val byTrace = usage.groupBy { it.traceId }
        val seen = HashSet<String>()
        val facts = roots.sortedWith(compareByDescending<TraceFact> { it.status != null }.thenByDescending { it.timestamp }).map { fact ->
            val rows = if (seen.add(fact.id)) byTrace[fact.id].orEmpty() else emptyList()
            fact.copy(cost = rows.sumOf { it.cost }, inputTokens = rows.sumOf { it.inputTokens }, outputTokens = rows.sumOf { it.outputTokens })
        }
        return facts to usage
    }

    fun rows(from: Instant, to: Instant, groupBy: String): List<MetricRow> {
        require(groupBy in GROUPINGS) { "Unknown grouping." }
        val (facts, usage) = window(from, to)
        if (facts.isEmpty()) return emptyList()
        return when (groupBy) {
            "day" -> facts.groupBy { it.timestamp.atZone(KST).toLocalDate().toString() }.toSortedMap().map { (key, group) -> traceRow(key, group) }
            "feature" -> facts.groupBy { it.feature }.map { (key, group) -> traceRow(key, group) }.mostRequestedFirst()
            else -> modelRows(facts, usage).mostRequestedFirst()
        }
    }

    /** A day or feature row: the group's roots give the counts, the tokens and the cost. */
    private fun traceRow(key: String, group: List<TraceFact>): MetricRow {
        val stats = group.usageStats()
        return MetricRow(key, stats.requests, stats.failureRate, stats.timeoutRate, stats.p50LatencyMs, stats.p95LatencyMs,
            group.sumOf { it.inputTokens }, group.sumOf { it.outputTokens }, stats.costUser, stats.costPlatform)
    }

    /**
     * A trace that used two models is a request of both; each model row carries only that model's tokens and cost, and counts the trace by the root it is
     * shown with. A usage row of an unknown trace is dropped.
     */
    private fun modelRows(facts: List<TraceFact>, usage: List<ObservationUsage>): List<MetricRow> {
        val factById = facts.distinctBy { it.id }.associateBy { it.id }
        return usage.filter { it.traceId in factById }.groupBy { it.model ?: "unknown" }.map { (model, rows) ->
            val stats = rows.map { factById.getValue(it.traceId) }.distinct().usageStats()
            val (charged, platform) = rows.partition { factById.getValue(it.traceId).userCharged }
            MetricRow(model, stats.requests, stats.failureRate, stats.timeoutRate, stats.p50LatencyMs, stats.p95LatencyMs,
                rows.sumOf { it.inputTokens }, rows.sumOf { it.outputTokens }, charged.sumOf { it.cost }, platform.sumOf { it.cost })
        }
    }

    private fun List<MetricRow>.mostRequestedFirst() = sortedWith(compareByDescending<MetricRow> { it.requests }.thenBy { it.key })
}
