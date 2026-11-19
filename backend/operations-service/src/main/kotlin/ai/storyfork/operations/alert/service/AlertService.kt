package ai.storyfork.operations.alert.service

import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.alert.entity.AlertRuleEntity
import ai.storyfork.operations.alert.entity.AlertStatus
import ai.storyfork.operations.alert.entity.OperationAlertEntity
import ai.storyfork.operations.alert.repository.AlertRuleRepository
import ai.storyfork.operations.alert.repository.OperationAlertRepository
import ai.storyfork.operations.alert.service.dto.*
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.has
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.server.ResponseStatusException

private const val LLM = "llm"
private const val JOBS = "jobs"
private const val NOTE_MAX = 500
private const val WINDOW_MAX = 10080
private const val LEAK_RULE = "leak_suspected"

/**
 * Alert list and handling for the llm or jobs admins, rule settings for llm admins. Every change is DB-only, so the change and its
 * activity record share one transaction (a failed record rolls the change back). Permission is checked before any input is read.
 */
@Service
@Transactional
class AlertService(
    private val alerts: OperationAlertRepository,
    private val rules: AlertRuleRepository,
    private val permissions: AdminPermissionRepository,
    private val activities: AdminActivityService,
) {
    @Transactional(readOnly = true)
    fun list(member: OperationsMember, status: String?): AlertListResponse {
        requireAlertAccess(member)
        require(status == null || status in AlertStatus.ALL) { "Unknown alert status." }
        val rows = if (status == null) alerts.findTop100ByOrderByCreatedAtDescIdDesc() else alerts.findTop100ByStatusOrderByCreatedAtDescIdDesc(status)
        return AlertListResponse(rows.map { it.response() })
    }

    fun act(member: OperationsMember, id: UUID, request: AlertActRequest): AlertResponse {
        requireAlertAccess(member)
        require(request.status == AlertStatus.ACKNOWLEDGED || request.status == AlertStatus.RESOLVED) { "Status must be acknowledged or resolved." }
        val note = request.note?.trim()?.takeIf { it.isNotEmpty() }
        require(note == null || (note.length <= NOTE_MAX && '\u0000' !in note)) { "Invalid note." }
        val alert = alerts.findById(id).orElseThrow { NoSuchElementException("Alert not found.") }
        // open -> acknowledged or resolved, acknowledged -> resolved. A resolved alert never changes; the same status twice is a conflict.
        if (alert.status == AlertStatus.RESOLVED || alert.status == request.status) throw ResponseStatusException(HttpStatus.CONFLICT)
        alert.status = request.status
        alert.actedBy = member.memberId
        alert.actedAt = Instant.now().truncatedTo(ChronoUnit.MICROS)
        alert.note = note
        alerts.saveAndFlush(alert)
        activities.record(member, if (request.status == AlertStatus.RESOLVED) "ALERT_RESOLVE" else "ALERT_ACKNOWLEDGE", "ALERT", alert.id, alert.ruleKey)
        return alert.response()
    }

    @Transactional(readOnly = true)
    fun rules(member: OperationsMember): AlertRuleListResponse {
        permissions.requirePermission(member, LLM)
        return AlertRuleListResponse(rules.findAllByOrderByRuleKeyAsc().map { it.response() })
    }

    fun updateRule(member: OperationsMember, key: String, request: AlertRuleRequest): AlertRuleResponse {
        permissions.requirePermission(member, LLM)
        val rule = rules.findById(key).orElseThrow { NoSuchElementException("Rule not found.") }
        val threshold = request.threshold
        require(threshold == null || (threshold.isFinite() && threshold >= 0)) { "Invalid threshold." }
        require(threshold == null || !rule.metric.endsWith("_rate") || threshold <= 1) { "A rate threshold is a fraction up to 1." }
        require(request.windowMinutes in 1..WINDOW_MAX) { "Invalid window." }
        // The leak rule has no value: switching it on is the whole setting. Every other rule is switched on with a value, as the contract says.
        require(!request.enabled || threshold != null || rule.ruleKey == LEAK_RULE) { "Set a threshold before switching the rule on." }
        rule.threshold = threshold?.toBigDecimal()
        rule.windowMinutes = request.windowMinutes
        rule.enabled = request.enabled
        rule.updatedAt = Instant.now().truncatedTo(ChronoUnit.MICROS)
        rules.saveAndFlush(rule)
        activities.record(member, "ALERT_RULE_UPDATE", "ALERT_RULE", rule.ruleKey,
            "threshold=${threshold ?: "-"} windowMinutes=${request.windowMinutes} enabled=${request.enabled}")
        return rule.response()
    }

    private fun requireAlertAccess(member: OperationsMember) {
        if (!(permissions.has(member, LLM) || permissions.has(member, JOBS))) throw ResponseStatusException(HttpStatus.FORBIDDEN)
    }

    private fun OperationAlertEntity.response() =
        AlertResponse(id, ruleKey, status, message, value?.toDouble(), targetRef, createdAt, actedBy, actedAt, note)

    private fun AlertRuleEntity.response() = AlertRuleResponse(ruleKey, metric, threshold?.toDouble(), windowMinutes, enabled, updatedAt)
}
