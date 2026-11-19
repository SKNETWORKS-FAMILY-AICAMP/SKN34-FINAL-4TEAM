package ai.storyfork.operations.alert

import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.alert.entity.AlertRuleEntity
import ai.storyfork.operations.alert.entity.OperationAlertEntity
import ai.storyfork.operations.alert.repository.AlertRuleRepository
import ai.storyfork.operations.alert.repository.OperationAlertRepository
import ai.storyfork.operations.alert.service.AlertService
import ai.storyfork.operations.alert.service.dto.AlertActRequest
import ai.storyfork.operations.alert.service.dto.AlertRuleRequest
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.security.OperationsMember
import java.math.BigDecimal
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.dao.OptimisticLockingFailureException
import org.springframework.orm.ObjectOptimisticLockingFailureException
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** Mocked repositories and activity service: no Spring context, HTTP or database. */
class AlertServiceTest {
    private val alerts = mock(OperationAlertRepository::class.java)
    private val rules = mock(AlertRuleRepository::class.java)
    private val permissions = mock(AdminPermissionRepository::class.java)
    private val activities = mock(AdminActivityService::class.java)
    private val service = AlertService(alerts, rules, permissions, activities)

    private val llmAdmin = OperationsMember(UUID.randomUUID(), true)
    private val jobsAdmin = OperationsMember(UUID.randomUUID(), true)
    private val noPermission = OperationsMember(UUID.randomUUID(), true)
    // A non-operator must stay denied even with stale grant rows.
    private val staleGrant = OperationsMember(UUID.randomUUID(), false)

    init {
        grant(llmAdmin, "llm")
        grant(jobsAdmin, "jobs")
        grant(staleGrant, "llm")
        grant(staleGrant, "jobs")
    }

    private fun grant(member: OperationsMember, key: String) {
        `when`(permissions.existsByMemberIdAndPermission(member.memberId, key)).thenReturn(true)
    }

    private fun alert(status: String = "open", ruleKey: String = "ai_failure_rate") = OperationAlertEntity(
        ruleKey = ruleKey, status = status, message = "AI 실패율이 기준을 넘었어요", value = BigDecimal("0.25"),
        targetRef = "trace-1", createdAt = Instant.parse("2026-11-19T01:00:00Z"),
    )

    private fun rule(key: String = "ai_failure_rate", metric: String = "failure_rate") =
        AlertRuleEntity(ruleKey = key, metric = metric, threshold = null, windowMinutes = 60, enabled = false)

    private fun assertStatus(status: HttpStatus, call: () -> Unit) {
        assertEquals(status, assertThrows(ResponseStatusException::class.java) { call() }.statusCode)
    }

    @Test
    fun `list needs an operator with the llm or jobs permission`() {
        `when`(alerts.findTop100ByOrderByCreatedAtDescIdDesc()).thenReturn(emptyList())

        assertEquals(emptyList<Any>(), service.list(llmAdmin, null).items)
        assertEquals(emptyList<Any>(), service.list(jobsAdmin, null).items)
        for (denied in listOf(noPermission, staleGrant)) assertStatus(HttpStatus.FORBIDDEN) { service.list(denied, null) }
    }

    @Test
    fun `list maps the newest alerts to the contract fields`() {
        val open = alert()
        val resolved = alert("resolved", "leak_suspected").also {
            it.actedBy = llmAdmin.memberId
            it.actedAt = Instant.parse("2026-11-19T02:00:00Z")
            it.note = "원작 카드 제목이 답변에 그대로 나왔어요"
        }
        `when`(alerts.findTop100ByOrderByCreatedAtDescIdDesc()).thenReturn(listOf(open, resolved))

        val items = service.list(llmAdmin, null).items

        assertEquals(listOf(open.id, resolved.id), items.map { it.id })
        assertEquals(listOf("ai_failure_rate", "leak_suspected"), items.map { it.ruleKey })
        assertEquals(listOf("open", "resolved"), items.map { it.status })
        assertEquals(0.25, items[0].value)
        assertEquals("trace-1", items[0].targetRef)
        assertEquals(Instant.parse("2026-11-19T01:00:00Z"), items[0].createdAt)
        assertNull(items[0].actedBy)
        assertEquals(llmAdmin.memberId, items[1].actedBy)
        assertEquals(Instant.parse("2026-11-19T02:00:00Z"), items[1].actedAt)
        assertEquals("원작 카드 제목이 답변에 그대로 나왔어요", items[1].note)
    }

    @Test
    fun `list filters by a valid status in the database and rejects any other status`() {
        `when`(alerts.findTop100ByStatusOrderByCreatedAtDescIdDesc("acknowledged")).thenReturn(listOf(alert("acknowledged")))

        assertEquals(listOf("acknowledged"), service.list(llmAdmin, "acknowledged").items.map { it.status })

        for (bad in listOf("OPEN", "closed", "")) assertThrows(IllegalArgumentException::class.java) { service.list(llmAdmin, bad) }
        verify(alerts, never()).findTop100ByOrderByCreatedAtDescIdDesc()
    }

    @Test
    fun `acknowledging records who and when and the activity after the save`() {
        val alert = alert()
        `when`(alerts.findById(alert.id)).thenReturn(Optional.of(alert))
        val before = Instant.now()

        val result = service.act(jobsAdmin, alert.id, AlertActRequest("acknowledged", "  확인했어요  "))

        assertEquals("acknowledged", alert.status)
        assertEquals(jobsAdmin.memberId, alert.actedBy)
        assertFalse(checkNotNull(alert.actedAt).isBefore(before))
        assertEquals("확인했어요", alert.note)
        assertEquals("acknowledged", result.status)
        val order = inOrder(alerts, activities)
        order.verify(alerts).saveAndFlush(alert)
        order.verify(activities).record(jobsAdmin, "ALERT_ACKNOWLEDGE", "ALERT", alert.id, "ai_failure_rate")
        verifyNoMoreInteractions(activities)
    }

    @Test
    fun `resolving records ALERT_RESOLVE and a blank note is stored as null`() {
        val open = alert()
        val acknowledged = alert("acknowledged")
        `when`(alerts.findById(open.id)).thenReturn(Optional.of(open))
        `when`(alerts.findById(acknowledged.id)).thenReturn(Optional.of(acknowledged))

        service.act(llmAdmin, open.id, AlertActRequest("resolved", "   "))
        service.act(llmAdmin, acknowledged.id, AlertActRequest("resolved"))

        assertEquals(listOf("resolved", "resolved"), listOf(open.status, acknowledged.status))
        assertNull(open.note)
        verify(activities).record(llmAdmin, "ALERT_RESOLVE", "ALERT", open.id, "ai_failure_rate")
        verify(activities).record(llmAdmin, "ALERT_RESOLVE", "ALERT", acknowledged.id, "ai_failure_rate")
    }

    @Test
    fun `a resolved alert never changes again and a repeated acknowledge is a conflict`() {
        val resolved = alert("resolved")
        val acknowledged = alert("acknowledged")
        `when`(alerts.findById(resolved.id)).thenReturn(Optional.of(resolved))
        `when`(alerts.findById(acknowledged.id)).thenReturn(Optional.of(acknowledged))

        assertStatus(HttpStatus.CONFLICT) { service.act(llmAdmin, resolved.id, AlertActRequest("acknowledged")) }
        assertStatus(HttpStatus.CONFLICT) { service.act(llmAdmin, resolved.id, AlertActRequest("resolved")) }
        assertStatus(HttpStatus.CONFLICT) { service.act(llmAdmin, acknowledged.id, AlertActRequest("acknowledged")) }

        assertEquals("resolved", resolved.status)
        verify(alerts, never()).saveAndFlush(resolved)
        verifyNoInteractions(activities)
    }

    @Test
    fun `an unknown alert is 404 an invalid status or note is 400 and a denied caller is 403 with nothing recorded`() {
        val alert = alert()
        `when`(alerts.findById(alert.id)).thenReturn(Optional.of(alert))
        `when`(alerts.findById(UUID.fromString("00000000-0000-0000-0000-000000000000"))).thenReturn(Optional.empty())

        assertThrows(NoSuchElementException::class.java) {
            service.act(llmAdmin, UUID.fromString("00000000-0000-0000-0000-000000000000"), AlertActRequest("resolved"))
        }
        for (bad in listOf(AlertActRequest("open"), AlertActRequest("done"), AlertActRequest("resolved", "가".repeat(501)), AlertActRequest("resolved", "a\u0000b"))) {
            assertThrows(IllegalArgumentException::class.java) { service.act(llmAdmin, alert.id, bad) }
        }
        assertStatus(HttpStatus.FORBIDDEN) { service.act(noPermission, alert.id, AlertActRequest("resolved")) }

        assertEquals("open", alert.status)
        verifyNoInteractions(activities)
    }

    @Test
    fun `a stale save is refused with the exception the common handler turns into 409 and records no activity`() {
        val alert = alert()
        `when`(alerts.findById(alert.id)).thenReturn(Optional.of(alert))
        doThrow(ObjectOptimisticLockingFailureException(OperationAlertEntity::class.java, alert.id)).`when`(alerts).saveAndFlush(alert)

        assertThrows(OptimisticLockingFailureException::class.java) { service.act(llmAdmin, alert.id, AlertActRequest("resolved")) }

        verifyNoInteractions(activities)
    }

    @Test
    fun `rules need the llm permission and jobs alone is denied`() {
        `when`(rules.findAllByOrderByRuleKeyAsc()).thenReturn(listOf(rule(), rule("leak_suspected", "leak_suspected").also { it.threshold = BigDecimal("3") }))

        val items = service.rules(llmAdmin).items

        assertEquals(listOf("ai_failure_rate", "leak_suspected"), items.map { it.key })
        assertEquals(listOf("failure_rate", "leak_suspected"), items.map { it.metric })
        assertEquals(listOf(null, 3.0), items.map { it.threshold })
        assertEquals(listOf(60, 60), items.map { it.windowMinutes })
        assertEquals(listOf(false, false), items.map { it.enabled })
        for (denied in listOf(jobsAdmin, noPermission)) assertStatus(HttpStatus.FORBIDDEN) { service.rules(denied) }
    }

    @Test
    fun `updating a rule stores threshold window and switch and records the new values`() {
        val rule = rule()
        `when`(rules.findById("ai_failure_rate")).thenReturn(Optional.of(rule))
        val before = Instant.now()

        val result = service.updateRule(llmAdmin, "ai_failure_rate", AlertRuleRequest(0.25, 30, true))

        assertEquals(BigDecimal("0.25"), rule.threshold)
        assertEquals(30, rule.windowMinutes)
        assertTrue(rule.enabled)
        assertFalse(rule.updatedAt.isBefore(before))
        assertEquals(0.25, result.threshold)
        assertTrue(result.enabled)
        val order = inOrder(rules, activities)
        order.verify(rules).saveAndFlush(rule)
        order.verify(activities).record(llmAdmin, "ALERT_RULE_UPDATE", "ALERT_RULE", "ai_failure_rate", "threshold=0.25 windowMinutes=30 enabled=true")
    }

    @Test
    fun `a rule may be switched off without a threshold and the leak rule needs none to be on`() {
        val failure = rule().also { it.threshold = BigDecimal("0.2"); it.enabled = true }
        val leak = rule("leak_suspected", "leak_suspected")
        `when`(rules.findById("ai_failure_rate")).thenReturn(Optional.of(failure))
        `when`(rules.findById("leak_suspected")).thenReturn(Optional.of(leak))

        service.updateRule(llmAdmin, "ai_failure_rate", AlertRuleRequest(null, 60, false))
        service.updateRule(llmAdmin, "leak_suspected", AlertRuleRequest(null, 1440, true))

        assertNull(failure.threshold)
        assertFalse(failure.enabled)
        assertTrue(leak.enabled)
        verify(activities).record(llmAdmin, "ALERT_RULE_UPDATE", "ALERT_RULE", "ai_failure_rate", "threshold=- windowMinutes=60 enabled=false")
    }

    @Test
    fun `an invalid rule update is 400 an unknown rule 404 and a denied caller 403 with nothing saved`() {
        `when`(rules.findById("ai_failure_rate")).thenReturn(Optional.of(rule()))
        `when`(rules.findById("ai_daily_cost_usd")).thenReturn(Optional.of(rule("ai_daily_cost_usd", "cost_usd")))
        `when`(rules.findById("nope")).thenReturn(Optional.empty())

        val invalid = listOf(
            "ai_failure_rate" to AlertRuleRequest(1.5, 60, true),       // a rate is a 0..1 fraction
            "ai_failure_rate" to AlertRuleRequest(-0.1, 60, false),
            "ai_failure_rate" to AlertRuleRequest(null, 60, true),      // switching on needs a value
            "ai_failure_rate" to AlertRuleRequest(0.2, 0, true),
            "ai_failure_rate" to AlertRuleRequest(0.2, 10081, true),
            "ai_daily_cost_usd" to AlertRuleRequest(Double.NaN, 60, false),
        )
        for ((key, request) in invalid) assertThrows(IllegalArgumentException::class.java) { service.updateRule(llmAdmin, key, request) }
        assertThrows(NoSuchElementException::class.java) { service.updateRule(llmAdmin, "nope", AlertRuleRequest(0.2, 60, true)) }
        assertStatus(HttpStatus.FORBIDDEN) { service.updateRule(jobsAdmin, "ai_failure_rate", AlertRuleRequest(0.2, 60, true)) }

        verify(rules, never()).saveAndFlush(any(AlertRuleEntity::class.java) ?: rule())
        verifyNoInteractions(activities)
    }

}
