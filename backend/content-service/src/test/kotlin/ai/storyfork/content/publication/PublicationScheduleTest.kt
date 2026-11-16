package ai.storyfork.content.publication

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.publication.entity.PublicationScheduleEntity
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class PublicationScheduleTest {
    private val due = Instant.parse("2026-11-10T08:00:00Z")

    @Test fun `editing moves the due time and stale cancellation cannot change it`() {
        val row = PublicationScheduleEntity(scheduledAt = due, versionId = "v1")
        row.reschedule(0, "v2", due.plusSeconds(60))
        assertEquals("v2", row.versionId)
        assertFalse(row.isDue(due))
        assertEquals(409, assertThrows(ContentFailure::class.java) { row.cancel(0, due) }.status)
        row.cancel(1, due)
        assertEquals("canceled", row.status)
        assertFalse(row.isDue(due.plusSeconds(60)))
    }

    @Test fun `completed failure stays visible and cannot run again`() {
        val row = PublicationScheduleEntity(scheduledAt = due)
        assertTrue(row.isDue(due))
        row.complete(due, "공개 제한 중")
        assertEquals("failed", row.status)
        assertEquals("공개 제한 중", row.failureReason)
        assertEquals(due, row.completedAt)
        assertFalse(row.isDue(due.plusSeconds(60)))
    }
}
