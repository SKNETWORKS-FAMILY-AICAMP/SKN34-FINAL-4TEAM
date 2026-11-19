package ai.storyfork.operations.alert.service

import ai.storyfork.operations.alert.entity.AlertStatus
import ai.storyfork.operations.alert.entity.OperationAlertEntity
import ai.storyfork.operations.alert.repository.OperationAlertRepository
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import java.util.UUID
import org.slf4j.LoggerFactory
import org.springframework.amqp.core.AmqpTemplate
import org.springframework.amqp.core.MessageBuilder
import org.springframework.amqp.core.MessageProperties
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import tools.jackson.databind.json.JsonMapper

/** 알림 사건 계약의 교환기와 사건 종류. Core가 처음 연결할 때 교환기·큐를 선언하므로 운영은 선언하지 않는다. */
private const val EXCHANGE = "storyfork.events"
private const val EVENT_TYPE = "operations.alert.raised"
private val UNRESOLVED = listOf(AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED)

/**
 * The one place an alert is created, shared by the metric checks and the leak sampling. A rule keeps a single unresolved alert, so a
 * breach that persists does not raise (or notify) again until an admin resolves the earlier one.
 */
@Service
class AlertRaiser(
    private val alerts: OperationAlertRepository,
    private val permissions: AdminPermissionRepository,
    private val amqp: AmqpTemplate,
    private val mapper: JsonMapper,
) {
    private val log = LoggerFactory.getLogger(AlertRaiser::class.java)

    /** Returns the new alert, or null when the rule already has an unresolved one. */
    fun raise(ruleKey: String, message: String, value: Double?, targetRef: String?): OperationAlertEntity? {
        if (alerts.existsByRuleKeyAndStatusIn(ruleKey, UNRESOLVED)) return null
        val alert = try {
            alerts.saveAndFlush(OperationAlertEntity(ruleKey = ruleKey, message = message.take(500), value = value?.toBigDecimal(), targetRef = targetRef?.take(100)))
        } catch (_: DataIntegrityViolationException) {
            return null // the partial unique index: another run raised it between the check and the insert
        }
        // ponytail: no outbox. A broker outage loses the notification but never the saved alert, which stays on the alert list;
        // add an outbox like Core's notification_outbox when delivery has to be guaranteed.
        try {
            publish(alert)
        } catch (error: Exception) {
            log.warn("Alert notification failed, the alert stays on the list: alertId={} cause={}", alert.id, error.toString())
        }
        return alert
    }

    /** One message per llm or jobs operator. The event id is fixed per alert and recipient, so a resend never makes a second notice in Core. */
    internal fun publish(alert: OperationAlertEntity) {
        val recipients = permissions.findAllByPermissionIn(listOf("llm", "jobs")).map { it.memberId }.distinct()
        for (recipient in recipients) {
            val eventId = UUID.nameUUIDFromBytes("${EVENT_TYPE}:${alert.id}:${recipient}".toByteArray())
            val body = mapper.writeValueAsBytes(mapOf(
                "schemaVersion" to 1, "eventId" to eventId.toString(), "type" to EVENT_TYPE, "occurredAt" to alert.createdAt.toString(),
                "recipientId" to recipient.toString(), "target" to mapOf("type" to "alert", "id" to alert.id.toString()),
            ))
            amqp.send(EXCHANGE, EVENT_TYPE, MessageBuilder.withBody(body)
                .setContentType(MessageProperties.CONTENT_TYPE_JSON).setMessageId(eventId.toString()).build())
        }
    }
}
