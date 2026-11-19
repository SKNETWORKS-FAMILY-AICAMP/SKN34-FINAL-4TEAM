package ai.storyfork.operations.alert

import ai.storyfork.operations.alert.entity.OperationAlertEntity
import ai.storyfork.operations.alert.repository.OperationAlertRepository
import ai.storyfork.operations.alert.service.AlertRaiser
import ai.storyfork.operations.member.entity.AdminPermissionEntity
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import java.math.BigDecimal
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.amqp.AmqpConnectException
import org.springframework.amqp.core.AmqpTemplate
import org.springframework.amqp.core.Message
import org.springframework.dao.DuplicateKeyException
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** Mocked repositories and AMQP template: no broker, Spring context or database. */
class AlertRaiserTest {
    private val saved = mutableListOf<OperationAlertEntity>()
    private var unresolvedExists = false
    private var saveFailure: RuntimeException? = null
    private val alerts = mock(OperationAlertRepository::class.java) { call ->
        when (call.method.name) {
            "existsByRuleKeyAndStatusIn" -> unresolvedExists
            "saveAndFlush" -> {
                saveFailure?.let { throw it }
                saved += call.arguments[0] as OperationAlertEntity
                call.arguments[0]
            }
            else -> null
        }
    }
    private val permissions = mock(AdminPermissionRepository::class.java)
    private val amqp = mock(AmqpTemplate::class.java)
    private val mapper = jacksonMapperBuilder().build()
    private val raiser = AlertRaiser(alerts, permissions, amqp, mapper)

    private val first = UUID.randomUUID()
    private val second = UUID.randomUUID()

    private fun recipients(vararg grants: Pair<UUID, String>) =
        `when`(permissions.findAllByPermissionIn(listOf("llm", "jobs"))).thenReturn(grants.map { AdminPermissionEntity(it.first, it.second) })

    /** Every send the template saw, as (exchange, routing key, message) without any matcher. */
    private fun sends() = mockingDetails(amqp).invocations.filter { it.method.name == "send" }
        .map { Triple(it.arguments[0] as String, it.arguments[1] as String, it.arguments[2] as Message) }

    @Test
    fun `raising saves the alert and sends one contract message per distinct recipient`() {
        recipients(first to "llm", first to "jobs", second to "jobs")

        val alert = checkNotNull(raiser.raise("ai_failure_rate", "AI 실패율이 기준을 넘었어요", 0.25, null))

        assertEquals(listOf(alert), saved)
        assertEquals("open", alert.status)
        assertEquals(BigDecimal("0.25"), alert.value)
        val sent = sends()
        assertEquals(2, sent.size)
        assertEquals(setOf("storyfork.events"), sent.map { it.first }.toSet())
        assertEquals(setOf("operations.alert.raised"), sent.map { it.second }.toSet())
        val bodies = sent.map { mapper.readTree(it.third.body) }
        assertEquals(setOf(first.toString(), second.toString()), bodies.map { it.path("recipientId").asString() }.toSet())
        for ((index, body) in bodies.withIndex()) {
            assertEquals(1, body.path("schemaVersion").asInt())
            assertEquals("operations.alert.raised", body.path("type").asString())
            assertEquals(alert.createdAt.toString(), body.path("occurredAt").asString())
            assertEquals("alert", body.path("target").path("type").asString())
            assertEquals(alert.id.toString(), body.path("target").path("id").asString())
            assertEquals(6, body.size())
            assertEquals(body.path("eventId").asString(), sent[index].third.messageProperties.messageId)
            assertEquals("application/json", sent[index].third.messageProperties.contentType)
        }
        assertEquals(2, bodies.map { it.path("eventId").asString() }.distinct().size)
        bodies.forEach { UUID.fromString(it.path("eventId").asString()) }
    }

    @Test
    fun `the same alert and recipient always get the same event id so Core can drop a resend`() {
        recipients(first to "llm")
        val alert = checkNotNull(raiser.raise("ai_failure_rate", "메시지", null, null))
        val firstId = mapper.readTree(sends().single().third.body).path("eventId").asString()

        raiser.publish(alert)

        assertEquals(listOf(firstId, firstId), sends().map { mapper.readTree(it.third.body).path("eventId").asString() })
    }

    @Test
    fun `nothing happens while the rule still has an unresolved alert`() {
        unresolvedExists = true

        assertNull(raiser.raise("ai_failure_rate", "메시지", 0.3, null))

        assertTrue(saved.isEmpty())
        verify(alerts).existsByRuleKeyAndStatusIn("ai_failure_rate", listOf("open", "acknowledged"))
        verifyNoInteractions(amqp, permissions)
    }

    @Test
    fun `a concurrent duplicate insert is skipped without a notification`() {
        saveFailure = DuplicateKeyException("operation_alert_one_unresolved_idx")

        assertNull(raiser.raise("ai_failure_rate", "메시지", 0.3, null))

        verifyNoInteractions(amqp)
    }

    @Test
    fun `a broker outage is logged and the saved alert is still returned`() {
        recipients(first to "llm", second to "jobs")
        doThrow(AmqpConnectException(java.net.ConnectException("refused"))).`when`(amqp).send(anyString(), anyString(), any(Message::class.java) ?: Message(ByteArray(0)))

        val alert = raiser.raise("ai_failure_rate", "메시지", 0.3, null)

        assertEquals(listOf(alert), saved)
        // The first failure ends the notification round: every further send would only wait for the same broker.
        assertEquals(1, sends().size)
    }

    @Test
    fun `with no llm or jobs operator the alert is saved and nobody is notified`() {
        recipients()

        assertNotNull(raiser.raise("job_failed", "작업 실패", 3.0, null))

        assertEquals(1, saved.size)
        verifyNoInteractions(amqp)
    }

    @Test
    fun `message and target reference are cut to their column sizes`() {
        recipients()

        val alert = checkNotNull(raiser.raise("leak_suspected", "가".repeat(600), null, "t".repeat(150)))

        assertEquals(500, alert.message.length)
        assertEquals(100, checkNotNull(alert.targetRef).length)
        assertNull(alert.value)
    }
}
