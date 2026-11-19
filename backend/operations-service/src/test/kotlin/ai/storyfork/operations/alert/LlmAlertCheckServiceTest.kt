package ai.storyfork.operations.alert

import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations.alert.entity.AlertRuleEntity
import ai.storyfork.operations.alert.entity.OperationAlertEntity
import ai.storyfork.operations.alert.repository.AlertRuleRepository
import ai.storyfork.operations.alert.service.AlertRaiser
import ai.storyfork.operations.alert.service.LlmAlertCheckService
import ai.storyfork.operations.llmops.service.AiUsageService
import ai.storyfork.operations.llmops.trace
import java.math.BigDecimal
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.JsonNode

/** Mocked rules, Langfuse and alert raiser (the usage aggregation runs for real): no network, broker, Spring context or database. */
class LlmAlertCheckServiceTest {
    private val rules = mock(AlertRuleRepository::class.java)
    private val langfuse = mock(LangfuseClient::class.java)
    // The raiser answers like the real one: a new alert, or null while the rule still has an unresolved one.
    private var raiserCreates = true
    private val raiser = mock(AlertRaiser::class.java) { call ->
        if (call.method.name == "raise" && raiserCreates) OperationAlertEntity(ruleKey = call.arguments[0] as String, message = "m") else null
    }
    private val service = LlmAlertCheckService(rules, AiUsageService(langfuse), raiser)
    private val now = Instant.parse("2026-11-19T05:00:00Z")

    // 4 requests: one failed, one timeout; costs 0.10 + 0.20 + 0.30 + 0.40 = 1.00; latencies 1, 2, 3, 10 seconds.
    private val traces: List<JsonNode> = listOf(
        trace("t1", status = "success", latency = 1.0, cost = 0.10), trace("t2", status = "failed", latency = 2.0, cost = 0.20),
        trace("t3", status = "timeout", latency = 10.0, cost = 0.30), trace("t4", status = "success", latency = 3.0, cost = 0.40),
    )

    private fun rule(key: String, threshold: String?, window: Int = 60, enabled: Boolean = true) =
        AlertRuleEntity(ruleKey = key, metric = key, threshold = threshold?.let { BigDecimal(it) }, windowMinutes = window, enabled = enabled)

    private fun givenEnabled(vararg enabled: AlertRuleEntity) = `when`(rules.findAllByEnabledTrue()).thenReturn(enabled.toList())

    private fun givenWindow(minutes: Long, found: List<JsonNode> = traces) =
        `when`(langfuse.allTraces(now.minusSeconds(minutes * 60), now)).thenReturn(found)

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
        verify(langfuse, times(1)).allTraces(now.minusSeconds(1800), now)
        assertEquals(3, raisedKeys().size)
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
        givenEnabled(rule("ai_failure_rate", null), rule("leak_suspected", null), rule("leak_suspected", "5"), rule("job_failed", "1"))

        assertEquals(0, service.run(now))

        verifyNoInteractions(langfuse, raiser)
    }

    @Test
    fun `nothing is read when no rule is switched on`() {
        givenEnabled()

        assertEquals(0, service.run(now))

        verifyNoInteractions(langfuse, raiser)
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
}
