package ai.storyfork.core.notification

import ai.storyfork.core.notification.messaging.RabbitNoticeEventPublisher
import ai.storyfork.core.notification.service.dto.NoticeEventMessage
import ai.storyfork.core.notification.service.dto.NoticeEventTarget
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.ArgumentCaptor
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.eq
import org.mockito.Mockito.doThrow
import org.mockito.Mockito.mock
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`
import org.springframework.amqp.core.Message
import org.springframework.amqp.core.MessageDeliveryMode
import org.springframework.amqp.core.MessageProperties
import org.springframework.amqp.rabbit.core.RabbitOperations
import org.springframework.amqp.rabbit.core.RabbitTemplate
import tools.jackson.databind.json.JsonMapper

/** 브로커 없이 발행 형식(교환기·routing key·messageId·영속·본문)과 "브로커 확인을 기다린다"는 약속을 확인한다. */
class RabbitNoticeEventPublisherTest {
    private val eventId = UUID.randomUUID().toString()
    private val message = NoticeEventMessage(
        schemaVersion = 1, eventId = eventId, type = "content.world.changed", occurredAt = "2026-11-09T00:00:00Z",
        recipientId = UUID.randomUUID().toString(), target = NoticeEventTarget("work", "work-1"),
    )
    private val ops = mock(RabbitOperations::class.java)
    private val rabbit = mock(RabbitTemplate::class.java).also { template ->
        `when`(template.invoke(any<RabbitOperations.OperationsCallback<Boolean>>())).thenAnswer {
            (it.arguments[0] as RabbitOperations.OperationsCallback<*>).doInRabbit(ops)
        }
    }
    private val publisher = RabbitNoticeEventPublisher(rabbit, JsonMapper.builder().build(), "storyfork.events", 5000)

    @Test
    fun `sends a persistent json message with the type as routing key and the event id as message id, then waits for the broker`() {
        publisher.publish(message)

        val sent = ArgumentCaptor.forClass(Message::class.java)
        verify(ops).send(eq("storyfork.events"), eq("content.world.changed"), sent.capture())
        assertEquals(eventId, sent.value.messageProperties.messageId)
        assertEquals(MessageDeliveryMode.PERSISTENT, sent.value.messageProperties.deliveryMode)
        assertEquals(MessageProperties.CONTENT_TYPE_JSON, sent.value.messageProperties.contentType)
        val body = String(sent.value.body, Charsets.UTF_8)
        assertTrue(body.contains("\"eventId\":\"$eventId\"") && body.contains("\"schemaVersion\":1"), body)
        verify(ops).waitForConfirmsOrDie(5000L)
    }

    @Test
    fun `a missing broker confirmation makes the publish fail so the outbox retries it`() {
        doThrow(IllegalStateException("no confirm")).`when`(ops).waitForConfirmsOrDie(5000L)
        assertThrows(IllegalStateException::class.java) { publisher.publish(message) }
    }
}
