package ai.storyfork.operations.alert

import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.ObservationUsage
import ai.storyfork.operations.alert.entity.AlertRuleEntity
import ai.storyfork.operations.alert.entity.OperationAlertEntity
import ai.storyfork.operations.alert.repository.AlertRuleRepository
import ai.storyfork.operations.alert.service.AlertRaiser
import ai.storyfork.operations.alert.service.LlmAlertCheckService
import ai.storyfork.operations.jobs.service.JobCountService
import ai.storyfork.operations.jobs.service.JobCounts
import ai.storyfork.operations.llmops.service.AiUsageService
import ai.storyfork.operations.llmops.root
import java.math.BigDecimal
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.JsonNode

/** Mocked rules, Langfuse, job counts and alert raiser (the usage aggregation runs for real): no network, broker, Spring context or database. */
class LlmAlertCheckServiceTest {
    private val rules = mock(AlertRuleRepository::class.java)
    private val langfuse = mock(LangfuseClient::class.java)
    // The raiser answers like the real one: a new alert, or null while the rule still has an unresolved one.
    private var raiserCreates = true
    private val raiser = mock(AlertRaiser::class.java) { call ->
        if (call.method.name == "raise" && raiserCreates) OperationAlertEntity(ruleKey = call.arguments[0] as String, message = "m") else null
    }
    private val jobs = mock(JobCountService::class.java)
    private val service = LlmAlertCheckService(rules, AiUsageService(langfuse), raiser, jobs)
    private val now = Instant.parse("2026-11-19T05:00:00Z")

    // 4 requests: one failed, one timeout; latencies 1, 2, 3, 10 seconds. A root has no cost: its generations do, 0.10 + 0.20 + 0.30 + 0.40 = 1.00.
    private val traces: List<JsonNode> = listOf(
        root("t1", status = "success", latency = 1.0), root("t2", status = "failed", latency = 2.0),
        root("t3", status = "timeout", latency = 10.0), root("t4", status = "success", latency = 3.0),
    )
    private val usage = listOf(
        ObservationUsage("t1", "gpt-5", 10, 1, 0.10), ObservationUsage("t2", "gpt-5", 10, 1, 0.20),
        ObservationUsage("t3", "gpt-5", 10, 1, 0.30), ObservationUsage("t4", "gpt-5", 10, 1, 0.40),
    )

    private fun rule(key: String, threshold: String?, window: Int = 60, enabled: Boolean = true) =
        AlertRuleEntity(ruleKey = key, metric = key, threshold = threshold?.let { BigDecimal(it) }, windowMinutes = window, enabled = enabled)

    private fun givenEnabled(vararg enabled: AlertRuleEntity) = `when`(rules.findAllByEnabledTrue()).thenReturn(enabled.toList())

    private fun givenWindow(minutes: Long, found: List<JsonNode> = traces, rows: List<ObservationUsage> = usage) {
        `when`(langfuse.allTraces(now.minusSeconds(minutes * 60), now)).thenReturn(found)
        `when`(langfuse.observationUsage(now.minusSeconds(minutes * 60), now)).thenReturn(rows)
    }

    // The job count the rule reads: failures in the rule's window (60 minutes unless the test says otherwise).
    private fun givenFailed(failed: Int, minutes: Long = 60) =
        `when`(jobs.counts(now.minusSeconds(minutes * 60))).thenReturn(JobCounts(running = 7, failed = failed))

    private fun raisedKeys() = mockingDetails(raiser).invocations.filter { it.method.name == "raise" }

    @Test
    fun `a rate above its threshold raises one alert with the value and a message with the numbers`() {
        givenEnabled(rule("ai_failure_rate", "0.2"), rule("ai_timeout_rate", "0.2"))
        givenWindow(60)

        val raised = service.run(now)

        assertEquals(2, raised)
        val calls = raisedKeys()
        assertEquals(listOf("ai_failure_rate", "ai_timeout_rate"), calls.map { it.arguments[0] })
        assertEquals(listOf(0.25, 0.25), calls.map { it.arguments[2] })
        assertEquals(listOf(null, null), calls.map { it.arguments[3] })
        val failureMessage = calls[0].arguments[1] as String
        assertTrue(failureMessage.contains("25.0%") && failureMessage.contains("20.0%") && failureMessage.contains("60분") && failureMessage.contains("4건"), failureMessage)
    }

    @Test
    fun `a value at or under the threshold raises nothing`() {
        givenEnabled(rule("ai_failure_rate", "0.25"), rule("ai_timeout_rate", "0.5"), rule("ai_daily_cost_usd", "1.00"), rule("ai_p95_latency_ms", "10000"))
        givenWindow(60)

        assertEquals(0, service.run(now))

        assertTrue(raisedKeys().isEmpty())
    }

    @Test
    fun `the cost rule sums user and platform cost and the latency rule compares the p95`() {
        givenEnabled(rule("ai_daily_cost_usd", "0.99", 1440), rule("ai_p95_latency_ms", "9999"))
        givenWindow(1440)
        givenWindow(60)

        service.run(now)

        val calls = raisedKeys()
        assertEquals(listOf("ai_daily_cost_usd", "ai_p95_latency_ms"), calls.map { it.arguments[0] })
        assertEquals(1.0, calls[0].arguments[2] as Double, 1e-9)
        assertEquals(10000.0, calls[1].arguments[2] as Double, 1e-9)
        assertTrue((calls[0].arguments[1] as String).contains("1440분"))
        assertTrue((calls[1].arguments[1] as String).contains("10000ms"))
    }

    @Test
    fun `rules with the same window share one Langfuse read and each other window reads once`() {
        givenEnabled(rule("ai_failure_rate", "0.1"), rule("ai_timeout_rate", "0.1"), rule("ai_p95_latency_ms", "100", 30))
        givenWindow(60)
        givenWindow(30)

        service.run(now)

        verify(langfuse, times(1)).allTraces(now.minusSeconds(3600), now)
        verify(langfuse, times(1)).observationUsage(now.minusSeconds(3600), now)
        verify(langfuse, times(1)).allTraces(now.minusSeconds(1800), now)
        verify(langfuse, times(1)).observationUsage(now.minusSeconds(1800), now)
        assertEquals(3, raisedKeys().size)
    }

    @Test
    fun `a request that waits or was cancelled is no request for the rates but its generations count for the cost`() {
        givenEnabled(rule("ai_failure_rate", "0.4"), rule("ai_daily_cost_usd", "1.09"))
        // t5 has no status and 0.10 of model calls: the failure rate stays 1 of 4 requests, the cost becomes 1.10.
        givenWindow(60, traces + listOf(root("t5", status = null, latency = 0.2)), usage + ObservationUsage("t5", "gpt-5", 10, 1, 0.10))

        val raised = service.run(now)

        assertEquals(1, raised)
        val call = raisedKeys().single()
        assertEquals("ai_daily_cost_usd", call.arguments[0])
        assertEquals(1.10, call.arguments[2] as Double, 1e-9)
    }

    @Test
    fun `no request in the window means no rate or latency alert`() {
        givenEnabled(rule("ai_failure_rate", "0"), rule("ai_timeout_rate", "0"), rule("ai_p95_latency_ms", "0"), rule("ai_daily_cost_usd", "0"))
        givenWindow(60, emptyList())
        givenWindow(1440, emptyList())

        assertEquals(0, service.run(now))
    }

    @Test
    fun `a rule without a value and the rules this check does not own are skipped without reading Langfuse`() {
        givenEnabled(rule("ai_failure_rate", null), rule("job_failed", null), rule("leak_suspected", null), rule("leak_suspected", "5"))

        assertEquals(0, service.run(now))

        verifyNoInteractions(langfuse, jobs, raiser)
    }

    @Test
    fun `nothing is read when no rule is switched on`() {
        givenEnabled()

        assertEquals(0, service.run(now))

        verifyNoInteractions(langfuse, jobs, raiser)
    }

    @Test
    fun `only alerts the raiser actually created are counted`() {
        givenEnabled(rule("ai_failure_rate", "0.1"))
        givenWindow(60)
        raiserCreates = false

        assertEquals(0, service.run(now))

        assertEquals(1, raisedKeys().size)
    }

    @Test
    fun `a Langfuse failure reaches the caller and raises nothing`() {
        givenEnabled(rule("ai_failure_rate", "0.1"))
        `when`(langfuse.allTraces(now.minusSeconds(3600), now)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { service.run(now) }.statusCode)

        assertTrue(raisedKeys().isEmpty())
    }

    @Test
    fun `job_failed raises one alert carrying the failed count and the numbers in its message`() {
        givenEnabled(rule("job_failed", "3", 1440))
        givenFailed(5, 1440)

        assertEquals(1, service.run(now))

        val call = raisedKeys().single()
        assertEquals(listOf("job_failed", 5.0, null), listOf(call.arguments[0], call.arguments[2], call.arguments[3]))
        val message = call.arguments[1] as String
        assertTrue(message.contains("실패한 작업이 5건") && message.contains("기준 3건") && message.contains("1440분"), message)
        verifyNoInteractions(langfuse)
    }

    @Test
    fun `job_failed alerts exactly at the threshold and not below it`() {
        givenEnabled(rule("job_failed", "3"))
        givenFailed(2)
        assertEquals(0, service.run(now))

        givenFailed(3)
        assertEquals(1, service.run(now))
    }

    @Test
    fun `job_failed counts only the failures in the rule's own window`() {
        givenEnabled(rule("job_failed", "3", 120))
        givenFailed(2, 120)

        assertEquals(0, service.run(now))

        verify(jobs, times(1)).counts(now.minusSeconds(7200))
        verifyNoMoreInteractions(jobs)
    }

    @Test
    fun `a zero threshold alerts on any failure but never on none`() {
        givenEnabled(rule("job_failed", "0"))
        givenFailed(0)
        assertEquals(0, service.run(now))

        givenFailed(1)
        assertEquals(1, service.run(now))
    }

    @Test
    fun `a fractional threshold is compared as it is and shown without trailing zeros`() {
        givenEnabled(rule("job_failed", "2.50"))
        givenFailed(2)
        assertEquals(0, service.run(now))

        givenFailed(3)
        assertEquals(1, service.run(now))

        assertTrue((raisedKeys().single().arguments[1] as String).contains("2.5건"))
    }

    @Test
    fun `job_failed and the AI rules are checked in one run`() {
        givenEnabled(rule("ai_failure_rate", "0.1"), rule("job_failed", "1"))
        givenWindow(60)
        givenFailed(4)

        assertEquals(2, service.run(now))

        assertEquals(listOf("ai_failure_rate", "job_failed"), raisedKeys().map { it.arguments[0] })
    }

    @Test
    fun `a standing job_failed breach is not raised again while the rule has an unresolved alert`() {
        givenEnabled(rule("job_failed", "1"))
        givenFailed(4)
        raiserCreates = false

        assertEquals(0, service.run(now))

        assertEquals(1, raisedKeys().size)
    }

    @Test
    fun `Content being down does not hide the AI alerts but still fails the run`() {
        givenEnabled(rule("ai_failure_rate", "0.1"), rule("job_failed", "1"))
        givenWindow(60)
        `when`(jobs.counts(now.minusSeconds(3600))).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { service.run(now) }.statusCode)

        assertEquals(listOf("ai_failure_rate"), raisedKeys().map { it.arguments[0] })
    }

    @Test
    fun `Langfuse being down does not hide the job alert but still fails the run`() {
        givenEnabled(rule("ai_failure_rate", "0.1"), rule("job_failed", "1"))
        `when`(langfuse.allTraces(now.minusSeconds(3600), now)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))
        givenFailed(2)

        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { service.run(now) }.statusCode)

        assertEquals(listOf("job_failed"), raisedKeys().map { it.arguments[0] })
    }

    @Test
    fun `both sources down fails the run with the first failure after trying both`() {
        givenEnabled(rule("ai_failure_rate", "0.1"), rule("job_failed", "1"))
        `when`(langfuse.allTraces(now.minusSeconds(3600), now)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))
        `when`(jobs.counts(now.minusSeconds(3600))).thenThrow(ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE))

        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException::class.java) { service.run(now) }.statusCode)

        verify(jobs, times(1)).counts(now.minusSeconds(3600))
    }

    @Test
    fun `an error that is not a failed upstream call is a bug and fails the run at once`() {
        givenEnabled(rule("ai_failure_rate", "0.1"), rule("job_failed", "1"))
        `when`(langfuse.allTraces(now.minusSeconds(3600), now)).thenThrow(IllegalStateException("bug"))
        givenFailed(2)

        assertThrows(IllegalStateException::class.java) { service.run(now) }

        assertTrue(raisedKeys().isEmpty())
    }

    @Test
    fun `the cost message keeps the significant digits of a sub-cent cost and of its threshold`() {
        // value to threshold, as the message shows them: cents from one dollar up, two significant digits below one (E2E: $0.0059 over $0.001 read "$0.01 over $0.00").
        val cases = listOf(
            Triple(0.0059, "0.001", "\$0.0059" to "\$0.001"),
            Triple(0.0123, "0.01", "\$0.012" to "\$0.01"),
            Triple(0.0010000001, "0.0005", "\$0.001" to "\$0.0005"),
            Triple(0.0004, "0", "\$0.0004" to "\$0.00"),
            Triple(0.45, "0.1", "\$0.45" to "\$0.10"),
            Triple(0.999, "0.5", "\$1.00" to "\$0.50"),
            Triple(12.34, "5", "\$12.34" to "\$5.00"),
        )
        for ((cost, threshold, shown) in cases) {
            givenEnabled(rule("ai_daily_cost_usd", threshold, 1440))
            givenWindow(1440, listOf(root("t1", status = "success")), listOf(ObservationUsage("t1", "gpt-5", 10, 1, cost)))

            service.run(now)

            assertEquals("AI 비용이 최근 1440분 동안 ${shown.first}로 기준 ${shown.second}를 넘었어요", raisedKeys().last().arguments[1])
        }
    }

    @Test
    fun `a rate under one percent keeps its significant digits in the message`() {
        // 1 failed and 1 timed-out request among 2500: 0.04% over a 0.01% threshold; one decimal would read "0.0% over 0.0%".
        val many = listOf(root("t1", status = "failed"), root("t2", status = "timeout")) + (3..2500).map { root("t${it}", status = "success") }
        givenEnabled(rule("ai_failure_rate", "0.0001"), rule("ai_timeout_rate", "0.0001"))
        givenWindow(60, many, emptyList())

        service.run(now)

        assertEquals(
            listOf("AI 요청 실패율이 0.04%로 기준 0.01%를 넘었어요 (최근 60분, 요청 2500건 중 1건 실패)", "AI 요청 시간 초과율이 0.04%로 기준 0.01%를 넘었어요 (최근 60분, 요청 2500건 중 1건 시간 초과)"),
            raisedKeys().map { it.arguments[1] },
        )
    }
}
