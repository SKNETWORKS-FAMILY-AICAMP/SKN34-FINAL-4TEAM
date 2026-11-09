package ai.storyfork.core.notification

import ai.storyfork.core.notification.messaging.NoticeOutboxRelay
import ai.storyfork.core.notification.service.NoticeEventPublisher
import ai.storyfork.core.notification.service.NoticeOutboxService
import ai.storyfork.core.notification.service.dto.NoticeEventMessage
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.never
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`

class NoticeOutboxRelayTest {
    private fun message(id: UUID) = NoticeEventMessage(schemaVersion = 1, eventId = id.toString(), type = "content.world.changed")

    @Test
    fun `every due event is published and then marked sent`() {
        val a = UUID.randomUUID(); val b = UUID.randomUUID()
        val outbox = mock(NoticeOutboxService::class.java)
        `when`(outbox.due(50)).thenReturn(listOf(message(a), message(b)))
        val published = mutableListOf<String?>()
        val relay = NoticeOutboxRelay(outbox, NoticeEventPublisher { published += it.eventId }, true, 50)

        assertEquals(2, relay.relayOnce())
        assertEquals(listOf(a.toString(), b.toString()), published)
        verify(outbox).markSent(a); verify(outbox).markSent(b)
    }

    @Test
    fun `a failed publish is recorded and does not stop the remaining events`() {
        val a = UUID.randomUUID(); val b = UUID.randomUUID()
        val outbox = mock(NoticeOutboxService::class.java)
        `when`(outbox.due(50)).thenReturn(listOf(message(a), message(b)))
        val relay = NoticeOutboxRelay(outbox, NoticeEventPublisher { if (it.eventId == a.toString()) throw IllegalStateException("broker down") }, true, 50)

        assertEquals(1, relay.relayOnce())
        verify(outbox).markFailed(a, "IllegalStateException")
        verify(outbox, never()).markSent(a)
        verify(outbox).markSent(b)
    }

    @Test
    fun `polling does nothing while the relay is switched off`() {
        val outbox = mock(NoticeOutboxService::class.java)
        NoticeOutboxRelay(outbox, NoticeEventPublisher { }, false, 50).poll()
        verify(outbox, never()).due(50)
    }
}
