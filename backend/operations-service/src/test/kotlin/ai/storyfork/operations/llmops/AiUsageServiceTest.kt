package ai.storyfork.operations.llmops

import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.ObservationUsage
import ai.storyfork.operations.llmops.service.AiUsageService
import ai.storyfork.operations.llmops.service.TraceFact
import ai.storyfork.operations.llmops.service.toTraceFact
import ai.storyfork.operations.llmops.service.usageStats
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import tools.jackson.databind.JsonNode

/** Mocked Langfuse client with canned request roots and usage rows: no network, Spring context or database. */
class AiUsageServiceTest {
    private val langfuse = mock(LangfuseClient::class.java)
    private val usage = AiUsageService(langfuse)
    private val from = Instant.parse("2026-11-18T00:00:00Z")
    private val to = Instant.parse("2026-11-20T00:00:00Z")
    private val charged1 = mapOf("credit_reservation_id" to "r-1")
    private val charged2 = mapOf("credit_reservation_id" to "r-2")

    // KST days: t1 is 11-18; t2, t3 and t4 are 11-19 (t2 is 01:00 KST although 16:00 UTC the day before).
    private val traces = listOf(
        root("t1", "2026-11-18T10:00:00Z", "qa", "success", 1.0, metadata = charged1),
        root("t2", "2026-11-18T16:00:00Z", "qa", "failed", 2.0),
        root("t3", "2026-11-19T01:00:00Z", "qa", "timeout", 10.0),
        root("t4", "2026-11-19T02:00:00Z", "writing", "success", 3.0, metadata = charged2),
    )
    private val rows = listOf(
        ObservationUsage("t1", "gpt-5", 100, 10, 0.10), ObservationUsage("t2", "gpt-5", 50, 5, 0.12), ObservationUsage("t2", "mini", 20, 2, 0.08),
        ObservationUsage("t3", "gpt-5", 30, 3, 0.30), ObservationUsage("t4", "mini", 40, 4, 0.40),
        ObservationUsage("ghost", "gpt-5", 999, 999, 9.0), // a trace outside the window's roots is not counted anywhere
    )

    private fun givenWindow(roots: List<JsonNode> = traces, usageRows: List<ObservationUsage> = rows) {
        `when`(langfuse.allTraces(from, to)).thenReturn(roots)
        `when`(langfuse.observationUsage(from, to)).thenReturn(usageRows)
    }

    private fun fact(root: JsonNode, cost: Double = 0.0): TraceFact = root.toTraceFact().copy(cost = cost)

    @Test
    fun `stats count requests failures and timeouts and split cost by credit reservation`() {
        val stats = listOf(fact(traces[0], 0.10), fact(traces[1], 0.20), fact(traces[2], 0.30), fact(traces[3], 0.40)).usageStats()

        assertEquals(4, stats.requests)
        assertEquals(1, stats.failed)
        assertEquals(1, stats.timeouts)
        assertEquals(0.25, stats.failureRate!!, 1e-9)
        assertEquals(0.25, stats.timeoutRate!!, 1e-9)
        assertEquals(0.50, stats.costUser, 1e-9)
        assertEquals(0.50, stats.costPlatform, 1e-9)
        // Nearest rank over [1000, 2000, 3000, 10000].
        assertEquals(2000L, stats.p50LatencyMs)
        assertEquals(10000L, stats.p95LatencyMs)
    }

    @Test
    fun `a root without a status is no request and no latency but its cost still counts`() {
        val stats = listOf(fact(root("a", latency = 4.0, status = "failed"), 0.10), fact(root("b", status = null, latency = 0.5), 0.20), fact(root("c", status = null, latency = null), 0.30)).usageStats()

        // A request that waits for the writer or was cancelled has no status: it is not counted, nor timed, but its model calls were paid for.
        assertEquals(listOf(1, 1, 0), listOf(stats.requests, stats.failed, stats.timeouts))
        assertEquals(1.0, stats.failureRate!!, 1e-9)
        assertEquals(listOf(4000L, 4000L), listOf(stats.p50LatencyMs, stats.p95LatencyMs))
        assertEquals(0.60, stats.costPlatform, 1e-9)
    }

    @Test
    fun `stats of an empty window have no rates or latencies and never a division by zero`() {
        val stats = emptyList<TraceFact>().usageStats()

        assertEquals(listOf(0, 0, 0), listOf(stats.requests, stats.failed, stats.timeouts))
        // No data is null, not a 0% rate or a 0 ms latency.
        assertNull(stats.failureRate)
        assertNull(stats.timeoutRate)
        assertEquals(listOf(null, null), listOf(stats.p50LatencyMs, stats.p95LatencyMs))
    }

    @Test
    fun `requests without a latency do not count in the percentiles`() {
        val stats = listOf(root("a", latency = 4.0), root("b", latency = null), root("c", latency = 2.0)).map { it.toTraceFact() }.usageStats()

        assertEquals(3, stats.requests)
        assertEquals(2000L, stats.p50LatencyMs)
        assertEquals(4000L, stats.p95LatencyMs)
    }

    @Test
    fun `finished requests without any latency have their rates but no percentiles`() {
        val stats = listOf(root("a", status = "failed", latency = null), root("b", latency = null)).map { it.toTraceFact() }.usageStats()

        assertEquals(2, stats.requests)
        assertEquals(0.5, stats.failureRate!!, 1e-9)
        assertEquals(0.0, stats.timeoutRate!!, 1e-9)
        assertEquals(listOf(null, null), listOf(stats.p50LatencyMs, stats.p95LatencyMs))
    }

    @Test
    fun `the facts of a window carry the cost and tokens of their trace's generations`() {
        givenWindow()

        val facts = usage.traceFacts(from, to).associateBy { it.id }

        assertEquals(listOf(0.10, 0.20, 0.30, 0.40), listOf("t1", "t2", "t3", "t4").map { facts.getValue(it).cost })
        assertEquals(listOf(100L, 70L, 30L, 40L), listOf("t1", "t2", "t3", "t4").map { facts.getValue(it).inputTokens })
        assertEquals(listOf(10L, 7L, 3L, 4L), listOf("t1", "t2", "t3", "t4").map { facts.getValue(it).outputTokens })
        assertFalse("ghost" in facts)
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
        assertEquals(1.0 / 3, second.failureRate!!, 1e-9)
        assertEquals(1.0 / 3, second.timeoutRate!!, 1e-9)
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
        assertEquals(1.0 / 3, gpt.failureRate!!, 1e-9)
        assertEquals(1.0 / 3, gpt.timeoutRate!!, 1e-9)
        assertEquals(0.10, gpt.costUser, 1e-9)
        assertEquals(0.42, gpt.costPlatform, 1e-9)
        val mini = result[1]
        assertEquals(2, mini.requests)
        assertEquals(listOf(60L, 6L), listOf(mini.inputTokens, mini.outputTokens))
        assertEquals(0.5, mini.failureRate!!, 1e-9)
        assertEquals(0.0, mini.timeoutRate)
        assertEquals(listOf(2000L, 3000L), listOf(mini.p50LatencyMs, mini.p95LatencyMs))
        assertEquals(0.40, mini.costUser, 1e-9)
        assertEquals(0.08, mini.costPlatform, 1e-9)
    }

    @Test
    fun `a generation without a model is the unknown model`() {
        givenWindow(listOf(root("t1")), listOf(ObservationUsage("t1", null, 1, 1, 0.0)))

        assertEquals(listOf("unknown"), usage.rows(from, to, "model").map { it.key })
    }

    @Test
    fun `a resumed turn is one request for its waiting root and its generations are counted once for its finished roots`() {
        val waiting = root("t1", "2026-11-19T01:00:00Z", "qa", null, 0.5, id = "r1")
        val success = root("t1", "2026-11-19T03:00:00Z", "qa", "success", 4.0, id = "r2")
        givenWindow(listOf(success, waiting), listOf(ObservationUsage("t1", "gpt-5", 100, 10, 0.10)))

        val row = usage.rows(from, to, "feature").single()

        // The waiting root has no status, so the turn is one request, timed by the request that finished it, with all of the turn's generations.
        assertEquals(listOf<Any>(1, 4000L), listOf(row.requests, row.p95LatencyMs))
        assertEquals(listOf(100L, 10L), listOf(row.inputTokens, row.outputTokens))
        assertEquals(0.10, row.costPlatform, 1e-9)
    }

    @Test
    fun `a trace with several finished requests counts each request but its generations once with the newest`() {
        val failed = root("t1", "2026-11-19T01:00:00Z", "qa", "failed", 1.0, id = "r1")
        val success = root("t1", "2026-11-19T03:00:00Z", "qa", "success", 2.0, id = "r2")
        givenWindow(listOf(failed, success), listOf(ObservationUsage("t1", "gpt-5", 100, 10, 0.10)))

        val facts = usage.traceFacts(from, to)
        val row = usage.rows(from, to, "feature").single()

        assertEquals(listOf(2, 0.5), listOf(row.requests, row.failureRate))
        assertEquals(listOf(100L, 10L), listOf(row.inputTokens, row.outputTokens))
        assertEquals(0.10, row.costPlatform, 1e-9)
        assertEquals(listOf(0.0, 0.10), facts.sortedBy { it.timestamp }.map { it.cost })
        // A model row is a request of the trace as a whole, shown by its newest finished request.
        val model = usage.rows(from, to, "model").single()
        assertEquals(listOf(1, 0.0), listOf(model.requests, model.failureRate))
    }

    @Test
    fun `the generations of a trace stay with its newest finished request even when a later request was cancelled`() {
        val finished = root("t1", "2026-11-19T01:00:00Z", "qa", "success", 1.0, id = "r1")
        val cancelled = root("t1", "2026-11-20T01:00:00Z", "qa", null, 0.5, id = "r2")
        givenWindow(listOf(cancelled, finished), listOf(ObservationUsage("t1", "gpt-5", 100, 10, 0.10)))

        val rows = usage.rows(from, to, "day")

        // The two requests fall on two Korean days; the cost stays with the one that was counted as a request, so the cancelled one's day has nothing to show.
        assertEquals(listOf("2026-11-19"), rows.map { it.key })
        assertEquals(listOf(1), rows.map { it.requests })
        assertEquals(listOf(0.10), rows.map { it.costPlatform })
    }

    @Test
    fun `a trace that only waits is no request but its model calls cost money`() {
        givenWindow(listOf(root("t1", "2026-11-19T01:00:00Z", "qa", null, 0.5)), listOf(ObservationUsage("t1", "gpt-5", 100, 10, 0.10)))

        val row = usage.rows(from, to, "day").single()

        assertEquals(listOf(0, null, null, null, null), listOf(row.requests, row.failureRate, row.timeoutRate, row.p50LatencyMs, row.p95LatencyMs))
        assertEquals(listOf(100L, 10L), listOf(row.inputTokens, row.outputTokens))
        assertEquals(0.10, row.costPlatform, 1e-9)
    }

    @Test
    fun `a row without a finished request but with tokens or cost stays, with no rates or latencies`() {
        val tokensOnly = root("t1", feature = "a", status = null)
        val platformCost = root("t2", feature = "b", status = null)
        val userCost = root("t3", feature = "c", status = null, metadata = charged1)
        givenWindow(listOf(tokensOnly, platformCost, userCost), listOf(
            ObservationUsage("t1", "gpt-5", 100, 10, 0.0), ObservationUsage("t2", "gpt-5", 0, 0, 0.10), ObservationUsage("t3", "gpt-5", 0, 0, 0.20),
        ))

        val result = usage.rows(from, to, "feature")

        assertEquals(listOf("a", "b", "c"), result.map { it.key })
        for (row in result) assertEquals(listOf(0, null, null, null, null), listOf(row.requests, row.failureRate, row.timeoutRate, row.p50LatencyMs, row.p95LatencyMs))
        assertEquals(listOf(110L, 0L, 0L), result.map { it.inputTokens + it.outputTokens })
        assertEquals(listOf(0.0, 0.10, 0.0), result.map { it.costPlatform })
        assertEquals(listOf(0.0, 0.0, 0.20), result.map { it.costUser })
    }

    @Test
    fun `a row without a finished request, tokens or cost is left out of every grouping`() {
        // The old root name of a feature: roots that never finished and made no model call. It said p50 0 ms and p95 0 ms on the metrics screen.
        val idle = root("t0", "2026-11-17T10:00:00Z", "writing_ai.orchestration", null, null)
        givenWindow(traces + listOf(idle), rows + ObservationUsage("t0", "gpt-0", 0, 0, 0.0))

        assertEquals(listOf("2026-11-18", "2026-11-19"), usage.rows(from, to, "day").map { it.key })
        assertEquals(listOf("qa", "writing"), usage.rows(from, to, "feature").map { it.key })
        assertEquals(listOf("gpt-5", "mini"), usage.rows(from, to, "model").map { it.key })
    }

    @Test
    fun `a row with a finished request stays even when the request made no model call`() {
        givenWindow(listOf(root("t1", feature = "a", status = "failed", latency = 2.0)), emptyList())

        val row = usage.rows(from, to, "feature").single()

        assertEquals(listOf(1, 1.0, 0.0, 2000L, 2000L), listOf(row.requests, row.failureRate, row.timeoutRate, row.p50LatencyMs, row.p95LatencyMs))
        assertEquals(listOf(0L, 0L, 0.0, 0.0), listOf(row.inputTokens, row.outputTokens, row.costUser, row.costPlatform))
    }

    @Test
    fun `an empty window makes no usage call and has no rows`() {
        `when`(langfuse.allTraces(from, to)).thenReturn(emptyList())

        assertTrue(usage.rows(from, to, "day").isEmpty())
        assertTrue(usage.traceFacts(from, to).isEmpty())

        verify(langfuse, never()).observationUsage(from, to)
    }

    @Test
    fun `an unknown grouping is rejected before Langfuse is called`() {
        for (bad in listOf("week", "", "DAY")) assertThrows(IllegalArgumentException::class.java) { usage.rows(from, to, bad) }

        verifyNoInteractions(langfuse)
    }
}
