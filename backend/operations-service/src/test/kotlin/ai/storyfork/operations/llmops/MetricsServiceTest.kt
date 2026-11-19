package ai.storyfork.operations.llmops

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.ContentOperationsStats
import ai.storyfork.operations._common.client.EditSuggestionStats
import ai.storyfork.operations._common.client.ProposalDecisionStats
import ai.storyfork.operations.llmops.service.AiUsageService
import ai.storyfork.operations.llmops.service.MetricsService
import ai.storyfork.operations.llmops.service.dto.MetricRow
import java.time.Duration
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** Mocked usage aggregation and Content client: no network, Spring context or database. */
class MetricsServiceTest {
    private val usage = mock(AiUsageService::class.java)
    private val content = mock(ContentClient::class.java)
    private val operators = Operators()
    private val service = MetricsService(operators.permissions, usage, content)
    private val from = Instant.parse("2026-11-12T00:00:00Z")
    private val to = Instant.parse("2026-11-19T00:00:00Z")
    private val row = MetricRow("2026-11-18", 4, 0.25, 0.0, 1000, 2000, 10, 20, 0.1, 0.2)

    private fun stats(adopted: Long, total: Long, approved: Long, decided: Long) =
        ContentOperationsStats(1, 2, ProposalDecisionStats(adopted, total), EditSuggestionStats(approved, decided))

    @Test
    fun `only an operator with the llm permission reads metrics`() {
        for (denied in listOf(operators.jobs, operators.none, operators.stale)) {
            assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException::class.java) { service.metrics(denied, from, to, "day") }.statusCode)
        }

        verifyNoInteractions(usage, content)
    }

    @Test
    fun `the rows come from Langfuse and the rates from Content's decision counts`() {
        `when`(usage.rows(from, to, "feature")).thenReturn(listOf(row))
        `when`(content.operationsStats(from, to)).thenReturn(stats(30, 50, 8, 10))

        val metrics = service.metrics(operators.llm, from, to, "feature")

        assertEquals(listOf(row), metrics.rows)
        assertEquals(0.6, metrics.adoptionRate)
        assertEquals(0.8, metrics.approvalRate)
        // No content filter exists yet, so there is nothing to restore: the screen shows "no data".
        assertNull(metrics.filterRestoreRate)
    }

    @Test
    fun `a rate with no decisions is null and never zero`() {
        `when`(usage.rows(from, to, "day")).thenReturn(emptyList())
        `when`(content.operationsStats(from, to)).thenReturn(stats(0, 0, 0, 0))

        val metrics = service.metrics(operators.llm, from, to, "day")

        assertNull(metrics.adoptionRate)
        assertNull(metrics.approvalRate)
        assertTrue(metrics.rows.isEmpty())
    }

    @Test
    fun `the window defaults to the last seven days and the grouping to day`() {
        `when`(usage.rows(org.mockito.ArgumentMatchers.any(Instant::class.java) ?: Instant.EPOCH, org.mockito.ArgumentMatchers.any(Instant::class.java) ?: Instant.EPOCH, org.mockito.ArgumentMatchers.anyString()))
            .thenReturn(emptyList())
        `when`(content.operationsStats(org.mockito.ArgumentMatchers.any(Instant::class.java) ?: Instant.EPOCH, org.mockito.ArgumentMatchers.any(Instant::class.java) ?: Instant.EPOCH))
            .thenReturn(stats(0, 0, 0, 0))
        val before = Instant.now()

        service.metrics(operators.llm, null, null, null)

        val call = mockingDetails(usage).invocations.single { it.method.name == "rows" }
        val start = call.arguments[0] as Instant
        val end = call.arguments[1] as Instant
        assertEquals(Duration.ofDays(7), Duration.between(start, end))
        assertFalse(end.isBefore(before))
        assertEquals("day", call.arguments[2])
        val stats = mockingDetails(content).invocations.single { it.method.name == "operationsStats" }
        assertEquals(listOf(start, end), stats.arguments.toList())
    }

    @Test
    fun `an empty or backwards window is rejected before any call`() {
        assertThrows(IllegalArgumentException::class.java) { service.metrics(operators.llm, to, from, "day") }
        assertThrows(IllegalArgumentException::class.java) { service.metrics(operators.llm, from, from, "day") }

        verifyNoInteractions(usage, content)
    }

    @Test
    fun `a Content failure is a 502 and never a metrics answer without the rates`() {
        `when`(usage.rows(from, to, "day")).thenReturn(listOf(row))
        `when`(content.operationsStats(from, to)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { service.metrics(operators.llm, from, to, "day") }.statusCode)
    }
}
