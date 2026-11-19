package ai.storyfork.operations.alert

import ai.storyfork.operations.alert.controller.AlertController
import ai.storyfork.operations.alert.service.AlertService
import ai.storyfork.operations.alert.service.dto.AlertActRequest
import ai.storyfork.operations.alert.service.dto.AlertListResponse
import ai.storyfork.operations.alert.service.dto.AlertResponse
import ai.storyfork.operations.alert.service.dto.AlertRuleListResponse
import ai.storyfork.operations.alert.service.dto.AlertRuleRequest
import ai.storyfork.operations.alert.service.dto.AlertRuleResponse
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** Spring context나 HTTP 서버 없이 인증 회원 전달과 계약 JSON 필드를 확인한다. */
class AlertControllerTest {
    private val service = mock(AlertService::class.java)
    private val controller = AlertController(service)
    private val member = OperationsMember(UUID.randomUUID(), true)
    private val mapper = jacksonMapperBuilder().build()

    @Test
    fun `every route passes the authenticated member and its arguments to the service`() {
        val id = UUID.randomUUID()
        val list = AlertListResponse(emptyList())
        val rules = AlertRuleListResponse(emptyList())
        val act = AlertActRequest("resolved", "끝")
        val update = AlertRuleRequest(0.2, 60, true)
        `when`(service.list(member, "open")).thenReturn(list)
        `when`(service.rules(member)).thenReturn(rules)

        assertSame(list, controller.list(member, "open"))
        assertSame(rules, controller.rules(member))
        controller.act(member, id, act)
        controller.updateRule(member, "ai_failure_rate", update)

        verify(service).act(member, id, act)
        verify(service).updateRule(member, "ai_failure_rate", update)
    }

    @Test
    fun `an alert and a rule serialize with exactly the contract fields and keep nulls`() {
        val id = UUID.randomUUID()
        val alert = AlertResponse(id, "ai_failure_rate", "open", "메시지", 0.25, null, Instant.parse("2026-11-19T01:00:00Z"), null, null, null)
        val rule = AlertRuleResponse("job_failed", "failed_jobs", null, 1440, false, Instant.parse("2026-11-19T01:00:00Z"))

        val a = mapper.readTree(mapper.writeValueAsString(AlertListResponse(listOf(alert)))).path("items").path(0)
        val r = mapper.readTree(mapper.writeValueAsString(AlertRuleListResponse(listOf(rule)))).path("items").path(0)

        assertEquals(listOf("id", "ruleKey", "status", "message", "value", "targetRef", "createdAt", "actedBy", "actedAt", "note"), a.propertyNames().toList())
        assertEquals(0.25, a.path("value").asDouble())
        assertTrue(a.path("targetRef").isNull)
        assertEquals("2026-11-19T01:00:00Z", a.path("createdAt").asString())
        assertEquals(listOf("key", "metric", "threshold", "windowMinutes", "enabled", "updatedAt"), r.propertyNames().toList())
        assertTrue(r.path("threshold").isNull)
        assertFalse(r.path("enabled").asBoolean())
    }

    @Test
    fun `request bodies read the contract JSON`() {
        val act = mapper.readValue("""{"status":"acknowledged","note":"확인"}""", AlertActRequest::class.java)
        val rule = mapper.readValue("""{"threshold":0.2,"windowMinutes":30,"enabled":true}""", AlertRuleRequest::class.java)
        val bare = mapper.readValue("""{"windowMinutes":60,"enabled":false}""", AlertRuleRequest::class.java)

        assertEquals(AlertActRequest("acknowledged", "확인"), act)
        assertEquals(AlertRuleRequest(0.2, 30, true), rule)
        assertNull(bare.threshold)
    }
}
