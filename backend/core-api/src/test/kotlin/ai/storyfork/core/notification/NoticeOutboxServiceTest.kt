package ai.storyfork.core.notification

import ai.storyfork.core.notification.entity.NoticeOutboxEntity
import ai.storyfork.core.notification.repository.NoticeOutboxRepository
import ai.storyfork.core.notification.service.NoticeOutboxService
import java.time.Duration
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`

class NoticeOutboxServiceTest {
    private val repo = mock(NoticeOutboxRepository::class.java)
    private val service = NoticeOutboxService(repo, 10, Duration.ofSeconds(5), Duration.ofMinutes(5))

    private fun row(attempts: Int = 0): NoticeOutboxEntity {
        val entity = NoticeOutboxEntity(
            id = UUID.randomUUID(), eventType = "content.world.changed", recipientId = UUID.randomUUID(),
            targetType = "work", targetId = "work-1", occurredAt = Instant.now(), attempts = attempts, nextAttemptAt = Instant.now(),
        )
        `when`(repo.findById(entity.id)).thenReturn(Optional.of(entity))
        return entity
    }

    private fun secondsUntilNextAttempt(entity: NoticeOutboxEntity) = Duration.between(Instant.now(), entity.nextAttemptAt).toMillis() / 1000.0

    @Test
    fun `the retry delay doubles on every failure starting at five seconds`() {
        val entity = row()
        for (expected in listOf(5, 10, 20)) {
            service.markFailed(entity.id, "broker down")
            val seconds = secondsUntilNextAttempt(entity)
            assertTrue(seconds > expected - 2.0 && seconds <= expected, "expected about ${expected}s but was ${seconds}s")
        }
        assertEquals(3, entity.attempts); assertEquals(NoticeOutboxEntity.PENDING, entity.status)
    }

    @Test
    fun `the retry delay never grows past the cap`() {
        val entity = row(attempts = 18)
        NoticeOutboxService(repo, 100, Duration.ofSeconds(5), Duration.ofMinutes(5)).markFailed(entity.id, "broker down")
        val seconds = secondsUntilNextAttempt(entity)
        assertTrue(seconds > 298.0 && seconds <= 300.0, "expected the five minute cap but was ${seconds}s")
    }

    @Test
    fun `reaching the attempt limit marks the event FAILED and keeps a short error`() {
        val entity = row(attempts = 9)
        service.markFailed(entity.id, "x".repeat(500))
        assertEquals(NoticeOutboxEntity.FAILED, entity.status)
        assertEquals(200, entity.lastError?.length)
    }
}
