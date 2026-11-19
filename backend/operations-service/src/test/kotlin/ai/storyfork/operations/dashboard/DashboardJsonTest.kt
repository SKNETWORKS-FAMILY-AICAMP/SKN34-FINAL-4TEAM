package ai.storyfork.operations.dashboard

import ai.storyfork.operations._common.client.MemberStats
import ai.storyfork.operations.dashboard.controller.DashboardController
import ai.storyfork.operations.dashboard.service.DashboardService
import ai.storyfork.operations.dashboard.service.dto.AiSummary
import ai.storyfork.operations.dashboard.service.dto.Dashboard
import ai.storyfork.operations.dashboard.service.dto.DashboardAi
import ai.storyfork.operations.dashboard.service.dto.DashboardJobs
import ai.storyfork.operations.dashboard.service.dto.DashboardPending
import ai.storyfork.operations.llmops.testMapper
import ai.storyfork.operations.security.OperationsMember
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

/** 계약의 Dashboard 모양(필드 이름·순서)과 컨트롤러의 인증 회원·Bearer 전달을 고정한다. */
class DashboardJsonTest {
    private fun names(node: tools.jackson.databind.JsonNode) = node.propertyNames().toList()

    @Test
    fun `a full dashboard has the contract fields`() {
        val summary = AiSummary(10, 2, 1, 0.2, 0.5, 1.5)
        val tree = testMapper.readTree(testMapper.writeValueAsString(
            Dashboard(MemberStats(100, 5, 1), DashboardAi(summary, summary), DashboardJobs(5, 2), DashboardPending(2, 5, 7), 3, emptyList()),
        ))

        assertEquals(listOf("members", "ai", "jobs", "pending", "openAlerts", "unavailable"), names(tree))
        assertEquals(listOf("total", "joinedLast7Days", "withdrawalPending"), names(tree.path("members")))
        assertEquals(listOf("today", "last7Days"), names(tree.path("ai")))
        assertEquals(listOf("requests", "failed", "timeouts", "failureRate", "costUser", "costPlatform"), names(tree.path("ai").path("today")))
        assertEquals(listOf("inquiries", "reports", "authorReviews"), names(tree.path("pending")))
        assertEquals(listOf("running", "failedLast24h"), names(tree.path("jobs")))
        assertEquals(5, tree.path("jobs").path("running").asInt())
        assertEquals(2, tree.path("jobs").path("failedLast24h").asInt())
        assertEquals(3, tree.path("openAlerts").asInt())
        assertEquals(emptyList<String>(), tree.path("unavailable").values().map { it.asString() })
    }

    @Test
    fun `an unavailable card is null and not missing but pending always keeps its database numbers`() {
        val tree = testMapper.readTree(testMapper.writeValueAsString(
            Dashboard(null, null, null, DashboardPending(2, 5, null), 0, listOf("core", "langfuse", "content")),
        ))

        for (card in listOf("members", "ai", "jobs")) assertTrue(tree.path(card).isNull, card)
        assertEquals(listOf("inquiries", "reports", "authorReviews"), names(tree.path("pending")))
        assertEquals(2, tree.path("pending").path("inquiries").asInt())
        assertEquals(5, tree.path("pending").path("reports").asInt())
        assertTrue(tree.path("pending").path("authorReviews").isNull)
        assertEquals(0, tree.path("openAlerts").asInt())
    }

    @Test
    fun `a period without requests has a null failure rate in the contract field`() {
        val tree = testMapper.readTree(testMapper.writeValueAsString(AiSummary(0, 0, 0, null, 0.0, 0.0)))

        assertEquals(listOf("requests", "failed", "timeouts", "failureRate", "costUser", "costPlatform"), names(tree))
        assertTrue(tree.path("failureRate").isNull)
    }

    @Test
    fun `the controller passes the member and the admin bearer`() {
        val service = mock(DashboardService::class.java)
        val member = OperationsMember(UUID.randomUUID(), true)

        DashboardController(service).get(member, "Bearer admin-access")

        // The service also takes the current time (a default argument), so the call is read back instead of stubbed.
        val call = mockingDetails(service).invocations.single { it.method.name == "get" }
        assertEquals(listOf<Any>(member, "Bearer admin-access"), call.arguments.take(2))
    }
}
