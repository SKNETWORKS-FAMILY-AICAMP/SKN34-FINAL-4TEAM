package ai.storyfork.operations.llmops

import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.util.UUID
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import tools.jackson.databind.JsonNode
import tools.jackson.module.kotlin.jacksonMapperBuilder

internal val testMapper = jacksonMapperBuilder().build()

internal fun json(text: String): JsonNode = testMapper.readTree(text)

/**
 * A Langfuse observation as the v2 observations API answers it with every field group asked for: the key set of the real v4 answer plus the
 * trace_context keys (LangfuseV4SampleTest keeps this builder honest against the real sample). Like the real answers it writes "no value" as an
 * empty text, and input and output are raw text, never JSON.
 */
internal fun observation(
    traceId: String, id: String, type: String = "SPAN", name: String = "qa", parent: String? = null, root: Boolean = false,
    startTime: String = "2026-11-19T01:00:00Z", latency: Double? = 1.5, level: String = "DEFAULT", statusMessage: String = "",
    userId: String = "user-1", model: String = "", usage: Map<String, Any?> = emptyMap(), cost: Double? = null, promptName: String = "",
    promptVersion: Int? = null, metadata: Map<String, Any?> = emptyMap(), tags: List<String> = emptyList(), traceName: String = "",
    input: String? = null, output: String? = null,
): JsonNode {
    fun text(value: Any?) = testMapper.writeValueAsString(value)
    val endTime = latency?.let { Instant.parse(startTime).plusMillis(Math.round(it * 1000)).toString() }
    return json("""{"id":${text(id)},"traceId":${text(traceId)},"startTime":${text(startTime)},"endTime":${text(endTime)},"projectId":"storyfork-writing-ai",
        "parentObservationId":${text(parent)},"type":${text(type)},"name":${text(name)},"level":${text(level)},"statusMessage":${text(statusMessage)},"version":"",
        "environment":"default","completionStartTime":null,"createdAt":${text(startTime)},"updatedAt":${text(startTime)},"input":${text(input)},"output":${text(output)},
        "metadata":${text(metadata + mapOf("scope.name" to "langfuse-sdk", "scope.version" to "4.18.0"))},"model":${text(model)},"internalModelId":"","modelParameters":{},
        "usageDetails":${text(usage)},"inputUsage":0,"outputUsage":0,"totalUsage":0,"costDetails":{},"inputCost":null,"outputCost":null,"totalCost":${text(cost)},
        "promptId":"","promptName":${text(promptName)},"promptVersion":${text(promptVersion)},"usagePricingTierId":null,"usagePricingTierName":null,
        "latency":${text(latency)},"timeToFirstToken":null,"userId":${text(userId)},"sessionId":"","isRootObservation":${root},"bookmarked":false,"public":false,
        "modelId":null,"inputPrice":null,"outputPrice":null,"totalPrice":null,"traceName":${text(traceName)},"release":"","tags":${text(tags)}}""")
}

/**
 * The request root the AI service writes (contract 1 to 3): named after the feature, tagged feature:<key>, with request_id and fork in its metadata and,
 * once the request has finished, status. A null [status] is a waiting or cancelled request. A failed or timed-out request has level ERROR.
 */
internal fun root(
    traceId: String, startTime: String = "2026-11-19T01:00:00Z", feature: String = "qa", status: String? = "success", latency: Double? = 1.5,
    userId: String = "user-1", metadata: Map<String, Any?> = emptyMap(), id: String = "root-$traceId", parent: String? = null, input: String? = null,
    output: String? = null,
): JsonNode = observation(
    traceId, id, name = feature, parent = parent, root = true, startTime = startTime, latency = latency, userId = userId, traceName = feature,
    level = if (status == null || status == "success") "DEFAULT" else "ERROR", tags = listOf("feature:$feature"), input = input, output = output,
    metadata = mapOf("request_id" to "req-$id", "fork" to "false") + (status?.let { mapOf("status" to it) } ?: emptyMap()) + metadata,
)

/** A model call under a request root: usage in usageDetails and the cost Langfuse computed, the way the real generations carry them. */
internal fun generation(
    traceId: String, id: String, startTime: String = "2026-11-19T01:00:01Z", latency: Double? = 1.0, model: String = "gpt-6-luna", inputTokens: Long = 100,
    outputTokens: Long = 20, cost: Double? = 0.01, parent: String? = "root-$traceId", name: String = "main_agent", input: String? = null, output: String? = null,
    promptName: String = "", promptVersion: Int? = null, level: String = "DEFAULT", statusMessage: String = "",
): JsonNode = observation(
    traceId, id, type = "GENERATION", name = name, parent = parent, startTime = startTime, latency = latency, model = model, cost = cost, input = input, output = output,
    usage = mapOf("input" to inputTokens, "output" to outputTokens, "total" to inputTokens + outputTokens), promptName = promptName, promptVersion = promptVersion,
    level = level, statusMessage = statusMessage,
)

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
