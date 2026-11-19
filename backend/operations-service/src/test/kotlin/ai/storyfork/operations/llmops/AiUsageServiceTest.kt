package ai.storyfork.operations.llmops

import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.ObservationUsage
import ai.storyfork.operations.llmops.service.AiUsageService
import ai.storyfork.operations.llmops.service.toTraceFact
import ai.storyfork.operations.llmops.service.usageStats
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

/** Mocked Langfuse client with canned traces and usage rows: no network, Spring context or database. */
class AiUsageServiceTest {
    private val langfuse = mock(LangfuseClient::class.java)
    private val usage = AiUsageService(langfuse)
    private val from = Instant.parse("2026-11-18T00:00:00Z")
    private val to = Instant.parse("2026-11-20T00:00:00Z")
    private val charged1 = """{"credit_reservation_id":"r-1"}"""
    private val charged2 = """{"credit_reservation_id":"r-2"}"""

    // KST days: t1 is 11-18; t2, t3 and t4 are 11-19 (t2 is 01:00 KST although 16:00 UTC the day before).
    private val traces = listOf(
        trace("t1", "2026-11-18T10:00:00Z", "qa", "success", 1.0, 0.10, metadata = charged1),
        trace("t2", "2026-11-18T16:00:00Z", "qa", "failed", 2.0, 0.20),
        trace("t3", "2026-11-19T01:00:00Z", "qa", "timeout", 10.0, 0.30),
        trace("t4", "2026-11-19T02:00:00Z", "writing", "success", 3.0, 0.40, metadata = charged2),
    )
    private val rows = listOf(
        ObservationUsage("t1", "gpt-5", 100, 10, 0.10), ObservationUsage("t2", "gpt-5", 50, 5, 0.12), ObservationUsage("t2", "mini", 20, 2, 0.08),
        ObservationUsage("t3", "gpt-5", 30, 3, 0.30), ObservationUsage("t4", "mini", 40, 4, 0.40),
        ObservationUsage("ghost", "gpt-5", 999, 999, 9.0), // a trace outside the window's trace list is not counted anywhere
    )

    private fun givenWindow() {
        `when`(langfuse.allTraces(from, to)).thenReturn(traces)
        `when`(langfuse.observationUsage(from, to)).thenReturn(rows)
    }

    @Test
    fun `stats count requests failures and timeouts and split cost by credit reservation`() {
        val stats = traces.map { it.toTraceFact() }.usageStats()

        assertEquals(4, stats.requests)
        assertEquals(1, stats.failed)
        assertEquals(1, stats.timeouts)
        assertEquals(0.25, stats.failureRate, 1e-9)
        assertEquals(0.25, stats.timeoutRate, 1e-9)
        assertEquals(0.50, stats.costUser, 1e-9)
        assertEquals(0.50, stats.costPlatform, 1e-9)
        // Nearest rank over [1000, 2000, 3000, 10000].
        assertEquals(2000L, stats.p50LatencyMs)
        assertEquals(10000L, stats.p95LatencyMs)
    }

    @Test
    fun `stats of an empty window are zeros and never a division by zero`() {
        val stats = emptyList<ai.storyfork.operations.llmops.service.TraceFact>().usageStats()

        assertEquals(listOf(0, 0, 0), listOf(stats.requests, stats.failed, stats.timeouts))
        assertEquals(0.0, stats.failureRate)
        assertEquals(0.0, stats.timeoutRate)
        assertEquals(listOf(0L, 0L), listOf(stats.p50LatencyMs, stats.p95LatencyMs))
    }

    @Test
    fun `traces without a latency do not count in the percentiles`() {
        val stats = listOf(trace("a", latency = 4.0), trace("b", latency = null), trace("c", latency = 2.0)).map { it.toTraceFact() }.usageStats()

        assertEquals(3, stats.requests)
        assertEquals(2000L, stats.p50LatencyMs)
        assertEquals(4000L, stats.p95LatencyMs)
    }

    @Test
    fun `rows by day use the Korean day and take tokens from the usage of the day's traces`() {
        givenWindow()

        val result = usage.rows(from, to, "day")

        assertEquals(listOf("2026-11-18", "2026-11-19"), result.map { it.key })
        val first = result[0]
        assertEquals(listOf(1, 0.0, 0.0, 1000L, 1000L), listOf(first.requests, first.failureRate, first.timeoutRate, first.p50LatencyMs, first.p95LatencyMs))
        assertEquals(listOf(100L, 10L), listOf(first.inputTokens, first.outputTokens))
        assertEquals(0.10, first.costUser, 1e-9)
        assertEquals(0.0, first.costPlatform, 1e-9)
        val second = result[1]
        assertEquals(3, second.requests)
        assertEquals(1.0 / 3, second.failureRate, 1e-9)
        assertEquals(1.0 / 3, second.timeoutRate, 1e-9)
        assertEquals(listOf(3000L, 10000L), listOf(second.p50LatencyMs, second.p95LatencyMs))
        assertEquals(listOf(140L, 14L), listOf(second.inputTokens, second.outputTokens))
        assertEquals(0.40, second.costUser, 1e-9)
        assertEquals(0.50, second.costPlatform, 1e-9)
    }

    @Test
    fun `rows by feature come most requested first`() {
        givenWindow()

        val result = usage.rows(from, to, "feature")

        assertEquals(listOf("qa", "writing"), result.map { it.key })
        assertEquals(listOf(3, 1), result.map { it.requests })
        assertEquals(listOf(200L, 20L), listOf(result[0].inputTokens, result[0].outputTokens))
        assertEquals(listOf(2000L, 10000L), listOf(result[0].p50LatencyMs, result[0].p95LatencyMs))
        assertEquals(listOf(0.10, 0.50), listOf(result[0].costUser, result[0].costPlatform))
        assertEquals(listOf(0.40, 0.0), listOf(result[1].costUser, result[1].costPlatform))
    }

    @Test
    fun `rows by model count a trace once per model with that model's tokens and cost`() {
        givenWindow()

        val result = usage.rows(from, to, "model")

        assertEquals(listOf("gpt-5", "mini"), result.map { it.key })
        val gpt = result[0]
        assertEquals(3, gpt.requests) // t1, t2, t3; the ghost row is dropped
        assertEquals(listOf(180L, 18L), listOf(gpt.inputTokens, gpt.outputTokens))
        assertEquals(1.0 / 3, gpt.failureRate, 1e-9)
        assertEquals(1.0 / 3, gpt.timeoutRate, 1e-9)
        assertEquals(0.10, gpt.costUser, 1e-9)
        assertEquals(0.42, gpt.costPlatform, 1e-9)
        val mini = result[1]
        assertEquals(2, mini.requests)
        assertEquals(listOf(60L, 6L), listOf(mini.inputTokens, mini.outputTokens))
        assertEquals(0.5, mini.failureRate, 1e-9)
        assertEquals(0.0, mini.timeoutRate)
        assertEquals(listOf(2000L, 3000L), listOf(mini.p50LatencyMs, mini.p95LatencyMs))
        assertEquals(0.40, mini.costUser, 1e-9)
        assertEquals(0.08, mini.costPlatform, 1e-9)
    }

    @Test
    fun `a generation without a model is the unknown model`() {
        `when`(langfuse.allTraces(from, to)).thenReturn(listOf(trace("t1")))
        `when`(langfuse.observationUsage(from, to)).thenReturn(listOf(ObservationUsage("t1", null, 1, 1, 0.0)))

        assertEquals(listOf("unknown"), usage.rows(from, to, "model").map { it.key })
    }

    @Test
    fun `an empty window makes no usage call and has no rows`() {
        `when`(langfuse.allTraces(from, to)).thenReturn(emptyList())

        assertTrue(usage.rows(from, to, "day").isEmpty())

        verify(langfuse, never()).observationUsage(from, to)
    }

    @Test
    fun `an unknown grouping is rejected before Langfuse is called`() {
        for (bad in listOf("week", "", "DAY")) assertThrows(IllegalArgumentException::class.java) { usage.rows(from, to, bad) }

        verifyNoInteractions(langfuse)
    }
}
