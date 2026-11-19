package ai.storyfork.operations.alert.service

import ai.storyfork.operations.alert.entity.AlertRuleEntity
import ai.storyfork.operations.alert.repository.AlertRuleRepository
import ai.storyfork.operations.llmops.service.AiUsageService
import ai.storyfork.operations.llmops.service.UsageStats
import ai.storyfork.operations.llmops.service.usageStats
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Locale
import org.springframework.stereotype.Service

/** The rules this check owns. job_failed waits for the jobs piece (ponytail: wire it to the job_run table after that merge); leak_suspected is raised by the leak sampling itself. */
private val AI_RULES = setOf("ai_failure_rate", "ai_timeout_rate", "ai_daily_cost_usd", "ai_p95_latency_ms")

/** Scheduled by the jobs piece (llm_alert_check); this is only the work of one run. */
@Service
class LlmAlertCheckService(
    private val rules: AlertRuleRepository,
    private val usage: AiUsageService,
    private val raiser: AlertRaiser,
) {
    /**
     * Compares every enabled AI rule that has a value with the last window of Langfuse data and raises an alert on a breach (the raiser keeps one
     * unresolved alert per rule). Rules with the same window share one Langfuse read. Returns how many new alerts were raised.
     * ponytail: a rate over a window with very few requests can breach on one failure; add a minimum request count if that gets noisy.
     */
    fun run(now: Instant = Instant.now()): Int {
        val statsByWindow = HashMap<Int, UsageStats>()
        var raised = 0
        for (rule in rules.findAllByEnabledTrue()) {
            if (rule.ruleKey !in AI_RULES) continue
            val threshold = rule.threshold?.toDouble() ?: continue
            val stats = statsByWindow.getOrPut(rule.windowMinutes) {
                usage.traceFacts(now.minus(rule.windowMinutes.toLong(), ChronoUnit.MINUTES), now).usageStats()
            }
            val (value, message) = breach(rule, threshold, stats) ?: continue
            if (raiser.raise(rule.ruleKey, message, value, null) != null) raised++
        }
        return raised
    }

    /** The observed value and its message when it is above the threshold; with no request in the window there is nothing to rate. */
    private fun breach(rule: AlertRuleEntity, threshold: Double, stats: UsageStats): Pair<Double, String>? {
        val window = "최근 ${rule.windowMinutes}분"
        return when (rule.ruleKey) {
            "ai_failure_rate" -> stats.failureRate.takeIf { stats.requests > 0 && it > threshold }
                ?.let { it to "AI 요청 실패율이 ${percent(it)}로 기준 ${percent(threshold)}를 넘었어요 ($window, 요청 ${stats.requests}건 중 ${stats.failed}건 실패)" }
            "ai_timeout_rate" -> stats.timeoutRate.takeIf { stats.requests > 0 && it > threshold }
                ?.let { it to "AI 요청 시간 초과율이 ${percent(it)}로 기준 ${percent(threshold)}를 넘었어요 ($window, 요청 ${stats.requests}건 중 ${stats.timeouts}건 시간 초과)" }
            "ai_daily_cost_usd" -> (stats.costUser + stats.costPlatform).takeIf { it > threshold }
                ?.let { it to "AI 비용이 $window 동안 ${usd(it)}로 기준 ${usd(threshold)}를 넘었어요" }
            "ai_p95_latency_ms" -> stats.p95LatencyMs.toDouble().takeIf { stats.requests > 0 && it > threshold }
                ?.let { it to "AI 응답 p95 지연이 ${stats.p95LatencyMs}ms로 기준 ${threshold.toLong()}ms를 넘었어요 ($window, 요청 ${stats.requests}건)" }
            else -> null
        }
    }

    private fun percent(fraction: Double) = String.format(Locale.ROOT, "%.1f%%", fraction * 100)

    private fun usd(amount: Double) = String.format(Locale.ROOT, "\$%.2f", amount)
}
