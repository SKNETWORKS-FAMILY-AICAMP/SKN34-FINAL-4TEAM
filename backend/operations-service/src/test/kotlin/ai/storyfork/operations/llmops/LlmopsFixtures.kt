package ai.storyfork.operations.llmops

import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.security.OperationsMember
import java.util.UUID
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import tools.jackson.databind.JsonNode
import tools.jackson.module.kotlin.jacksonMapperBuilder

internal val testMapper = jacksonMapperBuilder().build()

internal fun json(text: String): JsonNode = testMapper.readTree(text)

/** A Langfuse trace as the list endpoint returns it (tags follow the AI instrumentation rules). */
internal fun trace(
    id: String, timestamp: String = "2026-11-19T01:00:00Z", feature: String = "qa", status: String = "success", latency: Double? = 1.5,
    cost: Double = 0.01, userId: String? = "user-1", metadata: String = "{}", output: String = "null",
): JsonNode = json("""{"id":"$id","timestamp":"$timestamp","userId":${userId?.let { "\"$it\"" } ?: "null"},
    "tags":["feature:$feature","status:$status"],"metadata":$metadata,"latency":${latency ?: "null"},"totalCost":$cost,"output":$output}""")

/** A Langfuse list page: `data` plus `meta` with the total. */
internal fun page(total: Long, vararg items: JsonNode): JsonNode {
    val node = testMapper.createObjectNode()
    node.putArray("data").addAll(items.toList())
    node.putObject("meta").put("totalItems", total)
    return node
}

/** Operators and what they hold, as the admin_permission table would answer the services. */
internal class Operators {
    val llm = OperationsMember(UUID.randomUUID(), true)
    val jobs = OperationsMember(UUID.randomUUID(), true)
    val none = OperationsMember(UUID.randomUUID(), true)
    val stale = OperationsMember(UUID.randomUUID(), false)
    val permissions: AdminPermissionRepository = mock(AdminPermissionRepository::class.java).also {
        `when`(it.existsByMemberIdAndPermission(llm.memberId, "llm")).thenReturn(true)
        `when`(it.existsByMemberIdAndPermission(jobs.memberId, "jobs")).thenReturn(true)
        `when`(it.existsByMemberIdAndPermission(stale.memberId, "llm")).thenReturn(true)
    }
}
