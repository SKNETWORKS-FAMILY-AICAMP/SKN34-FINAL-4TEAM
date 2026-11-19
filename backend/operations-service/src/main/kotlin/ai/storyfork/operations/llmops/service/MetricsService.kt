package ai.storyfork.operations.llmops.service

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations.llmops.service.dto.Metrics
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.springframework.stereotype.Service

/** The metrics screen: Langfuse usage rows plus the adoption and approval rates from Content's decision counts. */
@Service
class MetricsService(
    private val permissions: AdminPermissionRepository,
    private val usage: AiUsageService,
    private val content: ContentClient,
) {
    /** The window defaults to the last 7 days and the grouping to day. A failing source fails the whole answer (502), never a partial one. */
    fun metrics(member: OperationsMember, from: Instant?, to: Instant?, groupBy: String?): Metrics {
        permissions.requirePermission(member, "llm")
        val end = to ?: Instant.now()
        val start = from ?: end.minus(7, ChronoUnit.DAYS)
        require(start.isBefore(end)) { "from must be before to." }
        val rows = usage.rows(start, end, groupBy ?: "day")
        val stats = content.operationsStats(start, end)
        // The content filter does not exist yet, so its restore rate stays null and the screen shows "no data".
        return Metrics(rows, ratio(stats.proposalDecisions.adopted, stats.proposalDecisions.total), ratio(stats.editSuggestions.approved, stats.editSuggestions.decided), null)
    }

    private fun ratio(part: Long, whole: Long): Double? = if (whole > 0) part.toDouble() / whole else null
}
