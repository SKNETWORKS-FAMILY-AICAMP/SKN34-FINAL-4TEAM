package ai.storyfork.core.notification.messaging

import ai.storyfork.core.notification.service.NoticeEventPublisher
import ai.storyfork.core.notification.service.dto.NoticeEventMessage
import org.springframework.amqp.core.MessageBuilder
import org.springframework.amqp.core.MessageDeliveryMode
import org.springframework.amqp.core.MessageProperties
import org.springframework.amqp.rabbit.core.RabbitOperations
import org.springframework.amqp.rabbit.core.RabbitTemplate
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import tools.jackson.databind.ObjectMapper

/** 사건을 계약 형식(JSON, routing key = type)으로 교환기에 발행하고 브로커 확인(publisher confirm)까지 기다린다. */
@Component
class RabbitNoticeEventPublisher(
    private val rabbit: RabbitTemplate,
    private val mapper: ObjectMapper,
    @Value("\${app.notification.events.exchange}") private val exchange: String,
    @Value("\${app.notification.outbox.confirm-timeout-ms:5000}") private val confirmTimeoutMs: Long,
) : NoticeEventPublisher {
    override fun publish(message: NoticeEventMessage) {
        val eventId = requireNotNull(message.eventId) { "eventId" }
        val routingKey = requireNotNull(message.type) { "type" }
        val body = MessageBuilder.withBody(mapper.writeValueAsBytes(message))
            .setContentType(MessageProperties.CONTENT_TYPE_JSON)
            .setMessageId(eventId)
            .setDeliveryMode(MessageDeliveryMode.PERSISTENT)
            .build()
        rabbit.invoke(RabbitOperations.OperationsCallback { ops ->
            ops.send(exchange, routingKey, body)
            ops.waitForConfirmsOrDie(confirmTimeoutMs)
            true
        })
    }
}
