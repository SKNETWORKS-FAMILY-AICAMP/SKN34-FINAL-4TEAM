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
    fun `every pending event is published and then marked sent`() {
        val a = UUID.randomUUID(); val b = UUID.randomUUID()
        val outbox = mock(NoticeOutboxService::class.java)
        `when`(outbox.pending()).thenReturn(listOf(message(a), message(b)))
        val published = mutableListOf<String?>()
        val relay = NoticeOutboxRelay(outbox, NoticeEventPublisher { published += it.eventId }, true)

        assertEquals(2, relay.relayOnce())
        assertEquals(listOf(a.toString(), b.toString()), published)
        verify(outbox).markSent(a); verify(outbox).markSent(b)
    }

    @Test
    fun `a failed publish stops the cycle and leaves every event pending for the next poll`() {
        val a = UUID.randomUUID(); val b = UUID.randomUUID()
        val outbox = mock(NoticeOutboxService::class.java)
        `when`(outbox.pending()).thenReturn(listOf(message(a), message(b)))
        val published = mutableListOf<String?>()
        val relay = NoticeOutboxRelay(outbox, NoticeEventPublisher {
            published += it.eventId
            throw IllegalStateException("broker down")
        }, true)

        assertEquals(0, relay.relayOnce())
        // 브로커 장애는 사건 하나의 문제가 아니므로 같은 주기의 나머지를 시도하지 않고 어떤 행도 바꾸지 않는다(오래 끊겨도 유실 없음).
        assertEquals(listOf(a.toString()), published)
        verify(outbox, never()).markSent(a); verify(outbox, never()).markSent(b)
    }

    @Test
    fun `polling does nothing while the relay is switched off`() {
        val outbox = mock(NoticeOutboxService::class.java)
        NoticeOutboxRelay(outbox, NoticeEventPublisher { }, false).poll()
        verify(outbox, never()).pending()
    }
}
