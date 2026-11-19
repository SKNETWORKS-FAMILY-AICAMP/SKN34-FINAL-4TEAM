package ai.storyfork.operations.llmops.service

import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.ObservationUsage
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

/** Trace list and detail for llm admins, read from Langfuse on every call. Permission is checked before any input or Langfuse call. */
@Service
class TraceService(private val permissions: AdminPermissionRepository, private val langfuse: LangfuseClient) {
    /** [page] starts at 0 and the size is fixed at 20; a [requestId] matches the trace metadata request_id. */
    fun list(member: OperationsMember, from: Instant?, to: Instant?, feature: String?, status: String?, userId: String?, requestId: String?, page: Int): TracePage {
        permissions.requirePermission(member, LLM)
        require(page >= 0) { "Invalid page." }
        val statusFilter = status.blankToNull()
        require(statusFilter == null || statusFilter in STATUSES) { "Unknown status." }
        val tags = listOfNotNull(feature.blankToNull()?.let { "feature:$it" }, statusFilter?.let { "status:$it" })
        val body = langfuse.traces(from, to, tags, userId.blankToNull(), requestId.blankToNull(), page + 1, PAGE_SIZE)
        val facts = body.path("data").values().map { it.toTraceFact() }
        // One usage query for the whole page, narrowed to its trace ids; a generation starts after its trace, so the oldest trace opens the window.
        val usage = if (facts.isEmpty()) emptyMap()
        else langfuse.observationUsage(facts.minOf { it.timestamp }.minusSeconds(60), Instant.now(), facts.map { it.id }).groupBy { it.traceId }
        return TracePage(facts.map { it.item(usage[it.id].orEmpty()) }, page, PAGE_SIZE, body.path("meta").path("totalItems").asLong(facts.size.toLong()))
    }

    fun detail(member: OperationsMember, id: String): TraceDetail {
        permissions.requirePermission(member, LLM)
        val node = langfuse.trace(id)
        val fact = node.toTraceFact()
        val observations = node.path("observations").values().map { it.observation() }
            .sortedWith(compareBy(nullsLast<Instant>()) { it.startTime })
        return TraceDetail(
            fact.id, fact.timestamp, fact.feature, fact.status, fact.latencyMs ?: 0, observations.sumOf { it.inputTokens ?: 0L },
            observations.sumOf { it.outputTokens ?: 0L }, fact.cost, fact.userId, fact.workId,
            node.path("input").takeUnless { it.isMissingNode || it.isNull }, fact.output, observations,
        )
    }

    private fun TraceFact.item(usage: List<ObservationUsage>) = TraceItem(
        id, timestamp, feature, status, latencyMs ?: 0, usage.sumOf { it.inputTokens }, usage.sumOf { it.outputTokens }, cost, userId, workId,
    )

    private fun JsonNode.observation(): TraceObservation {
        val start = path("startTime").textOrNull()?.let(Instant::parse)
        val end = path("endTime").textOrNull()?.let(Instant::parse)
        return TraceObservation(
            path("id").asString(), path("name").textOrNull() ?: "", path("type").textOrNull() ?: "SPAN", start, end,
            if (start != null && end != null) Duration.between(start, end).toMillis() else 0, path("model").textOrNull(),
            tokens("input", "promptTokens"), tokens("output", "completionTokens"), path("level").textOrNull() ?: "DEFAULT",
            path("statusMessage").textOrNull(), path("promptName").textOrNull(), path("promptVersion").takeIf { it.isNumber }?.asInt(),
        )
    }

    /** usageDetails (current) before usage (older); the legacy prompt/completion names last. */
    private fun JsonNode.tokens(key: String, legacy: String): Long? =
        listOf(path("usageDetails").path(key), path("usage").path(key), path("usage").path(legacy)).firstOrNull { it.isNumber }?.asLong()

    private fun String?.blankToNull() = this?.trim()?.takeIf { it.isNotEmpty() }
}
