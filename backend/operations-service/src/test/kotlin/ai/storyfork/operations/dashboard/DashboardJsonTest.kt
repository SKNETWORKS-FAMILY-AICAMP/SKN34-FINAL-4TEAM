package ai.storyfork.operations.dashboard

import ai.storyfork.operations._common.client.MemberStats
import ai.storyfork.operations.dashboard.controller.DashboardController
import ai.storyfork.operations.dashboard.service.DashboardService
import ai.storyfork.operations.dashboard.service.dto.AiSummary
import ai.storyfork.operations.dashboard.service.dto.Dashboard
import ai.storyfork.operations.dashboard.service.dto.DashboardAi
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
            Dashboard(MemberStats(100, 5, 1), DashboardAi(summary, summary), null, DashboardPending(2, 5, 7), 3, listOf("jobs")),
        ))

        assertEquals(listOf("members", "ai", "jobs", "pending", "openAlerts", "unavailable"), names(tree))
        assertEquals(listOf("total", "joinedLast7Days", "withdrawalPending"), names(tree.path("members")))
        assertEquals(listOf("today", "last7Days"), names(tree.path("ai")))
        assertEquals(listOf("requests", "failed", "timeouts", "failureRate", "costUser", "costPlatform"), names(tree.path("ai").path("today")))
        assertEquals(listOf("inquiries", "reports", "authorReviews"), names(tree.path("pending")))
        assertTrue(tree.path("jobs").isNull)
        assertEquals(3, tree.path("openAlerts").asInt())
        assertEquals(listOf("jobs"), tree.path("unavailable").values().map { it.asString() })
    }

    @Test
    fun `an unavailable card is null and not missing`() {
        val tree = testMapper.readTree(testMapper.writeValueAsString(Dashboard(null, null, null, null, 0, listOf("core", "langfuse", "content", "jobs"))))

        for (card in listOf("members", "ai", "jobs", "pending")) assertTrue(tree.path(card).isNull, card)
        assertEquals(0, tree.path("openAlerts").asInt())
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
