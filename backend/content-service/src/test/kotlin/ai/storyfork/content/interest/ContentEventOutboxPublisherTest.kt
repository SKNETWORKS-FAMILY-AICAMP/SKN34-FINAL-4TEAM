package ai.storyfork.content.interest

import ai.storyfork.content.interest.entity.ContentEventOutboxEntity
import ai.storyfork.content.interest.messaging.ContentEventOutboxPublisher
import ai.storyfork.content.interest.repository.ContentEventOutboxRepository
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mock
import org.mockito.Mockito.*
import org.mockito.junit.jupiter.MockitoExtension
import org.springframework.amqp.AmqpConnectException
import org.springframework.amqp.core.AmqpTemplate
import org.springframework.amqp.core.Message
import tools.jackson.databind.json.JsonMapper

@ExtendWith(MockitoExtension::class)
class ContentEventOutboxPublisherTest {
    @Mock lateinit var outbox: ContentEventOutboxRepository
    @Mock lateinit var amqp: AmqpTemplate
    private val mapper = JsonMapper.builder().build()
    private lateinit var publisher: ContentEventOutboxPublisher

    @BeforeEach fun setUp() { publisher = ContentEventOutboxPublisher(outbox, amqp, mapper) }

    private fun row(recipient: String, at: String = "2026-11-09T01:02:03.123456Z") = ContentEventOutboxEntity(
        id = UUID.randomUUID(), type = "content.episode.published", recipientId = recipient, targetType = "work", targetId = "work-1", occurredAt = Instant.parse(at))
    private fun pending(vararg rows: ContentEventOutboxEntity) =
        `when`(outbox.findTop100ByPublishedAtIsNullOrderByOccurredAtAscIdAsc()).thenReturn(rows.toList())
    private fun sends() = mockingDetails(amqp).invocations.filter { it.method.name == "send" }

    @Test fun `a pending row is sent in the notification contract format and then marked published`() {
        val reader = row("reader-1")
        pending(reader)

        publisher.publishPending()

        val call = sends().single()
        assertEquals("storyfork.events", call.getArgument<String>(0))
        assertEquals("content.episode.published", call.getArgument<String>(1))
        val message = call.getArgument<Message>(2)
        val json = mapper.readTree(message.body)
        assertEquals(1, json.path("schemaVersion").asInt())
        assertEquals(reader.id.toString(), json.path("eventId").asString())
        assertEquals("content.episode.published", json.path("type").asString())
        assertEquals("2026-11-09T01:02:03.123456Z", json.path("occurredAt").asString())
        assertEquals("reader-1", json.path("recipientId").asString())
        assertEquals("work", json.path("target").path("type").asString())
        assertEquals("work-1", json.path("target").path("id").asString())
        assertEquals(setOf("schemaVersion", "eventId", "type", "occurredAt", "recipientId", "target"), json.propertyNames().toSet())
        assertEquals("application/json", message.messageProperties.contentType)
        assertEquals(reader.id.toString(), message.messageProperties.messageId)
        assertNotNull(reader.publishedAt)
        verify(outbox).save(reader)
    }

    @Test fun `rows go out oldest first and each one is marked as soon as it is sent`() {
        val first = row("reader-1")
        val second = row("reader-2")
        pending(first, second)

        publisher.publishPending()

        assertEquals(listOf("reader-1", "reader-2"), sends().map { mapper.readTree(it.getArgument<Message>(2).body).path("recipientId").asString() })
        assertTrue(first.publishedAt != null && second.publishedAt != null)
    }

    @Test fun `a failed send leaves the row pending and stops the cycle so order is kept for the retry`() {
        val first = row("reader-1")
        val second = row("reader-2")
        pending(first, second)
        doThrow(AmqpConnectException(java.net.ConnectException("broker down"))).`when`(amqp).send(anyString(), anyString(), any(Message::class.java) ?: Message(ByteArray(0)))

        publisher.publishPending()

        assertEquals(1, sends().size)
        assertNull(first.publishedAt)
        assertNull(second.publishedAt)
        verify(outbox, never()).save(any(ContentEventOutboxEntity::class.java) ?: first)
    }

    @Test fun `nothing pending sends nothing`() {
        pending()

        publisher.publishPending()

        assertTrue(sends().isEmpty())
        verify(outbox, never()).save(any(ContentEventOutboxEntity::class.java) ?: row("x"))
    }
}
