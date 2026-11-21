package ai.storyfork.operations.llmops.service

import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.MAX_TRACES
import ai.storyfork.operations._common.client.instantOrNull
import ai.storyfork.operations._common.client.textOrNull
import ai.storyfork.operations.llmops.service.dto.Pipeline
import ai.storyfork.operations.llmops.service.dto.PipelineNode
import ai.storyfork.operations.llmops.service.dto.PipelineRecord
import ai.storyfork.operations.llmops.service.dto.PipelineRecordPage
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlin.math.roundToLong
import org.springframework.stereotype.Service
import tools.jackson.databind.JsonNode

private const val LLM = "llm"
private const val PAGE_SIZE = 20
private val LEVELS = setOf("DEBUG", "DEFAULT", "WARNING", "ERROR")

/**
 * The AI pipeline of the writing chat as Langfuse recorded it (DEC-58, docs/design/operations-ai-pipeline-contract.md): the fixed node list ([PIPELINE_NODES]) with
 * what each node did in a window, and the observations behind a node. Permission is checked before any input or Langfuse call; nothing is cached.
 */
@Service
class PipelineService(private val permissions: AdminPermissionRepository, private val langfuse: LangfuseClient) {
    /**
     * The window defaults to the last 7 days. Four Langfuse reads in all, two for the chat and two for the standalone features. The counts, the errors (level
     * ERROR) and the prompts are exact (the Metrics API groups them). ponytail: the p95 of a node is the largest p95 among its observation names, not the p95
     * of all its observations (that would take a query per node).
     */
    fun pipeline(member: OperationsMember, from: Instant?, to: Instant?): Pipeline {
        permissions.requirePermission(member, LLM)
        val (start, end) = window(from, to)
        val reads = PIPELINE_NODES.map { it.standalone }.distinct().associateWith { standalone ->
            val features = PIPELINE_NODES.filter { it.standalone == standalone }.map { it.feature }.distinct()
            langfuse.observationGroups(start, end, features) to langfuse.observationLatencies(start, end, features)
        }
        return Pipeline(PIPELINE_NODES.map { node ->
            val (groups, latencies) = reads.getValue(node.standalone)
            val own = groups.filter { node.owns(it.name) }
            PipelineNode(
                node.id, node.label, node.next, node.standalone, own.sumOf { it.count }, own.filter { it.level == "ERROR" }.sumOf { it.count },
                latencies.filterKeys(node::owns).values.maxOrNull()?.roundToLong(), own.mapNotNull { it.promptName }.distinct().sorted(),
            )
        })
    }

    /**
     * A page of a node's observations, newest first, 20 a page from page 0, optionally of one Langfuse [level]. An unknown node is 404 (checked before the rest of
     * the input). ponytail: only the newest 1,000 observations of a node are reachable by paging; narrow the window or the level to see older ones.
     */
    fun records(member: OperationsMember, nodeId: String, from: Instant?, to: Instant?, level: String?, page: Int): PipelineRecordPage {
        permissions.requirePermission(member, LLM)
        val node = PIPELINE_NODES.firstOrNull { it.id == nodeId } ?: throw NoSuchElementException("Pipeline node not found.")
        val (start, end) = window(from, to)
        val levelFilter = level?.trim()?.takeIf { it.isNotEmpty() }
        require(levelFilter == null || levelFilter in LEVELS) { "Unknown level." }
        require(page >= 0 && (page + 1) * PAGE_SIZE <= MAX_TRACES) { "Invalid page." }
        val rows = langfuse.pipelineObservations(start, end, node.feature, node.names, node.prefix, levelFilter, page * PAGE_SIZE, PAGE_SIZE)
        return PipelineRecordPage(rows.items.map { it.record() }, page, PAGE_SIZE, rows.total)
    }

    /** An empty or backwards window is rejected (400), like the metrics window. */
    private fun window(from: Instant?, to: Instant?): Pair<Instant, Instant> {
        val end = to ?: Instant.now()
        val start = from ?: end.minus(7, ChronoUnit.DAYS)
        require(start.isBefore(end)) { "from must be before to." }
        return start to end
    }

    private fun JsonNode.record() = PipelineRecord(
        path("id").asString(), path("traceId").asString(), path("name").textOrNull() ?: "", path("type").textOrNull() ?: "SPAN", path("startTime").instantOrNull(), latencyMsOrNull(),
        path("level").textOrNull() ?: "DEFAULT", path("statusMessage").textOrNull(), path("model").textOrNull(), path("promptName").textOrNull(),
        path("promptVersion").takeIf { it.isNumber }?.asInt(), path("input").clipped(), path("output").clipped(), path("metadata").ownMetadata(),
    )
}
