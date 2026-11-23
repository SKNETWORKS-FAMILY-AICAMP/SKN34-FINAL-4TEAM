package ai.storyfork.operations.alert

import ai.storyfork.operations.alert.repository.OperationAlertRepository
import ai.storyfork.operations.alert.service.AlertCleanupService
import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

class AlertCleanupServiceTest {
    private val alerts = mock(OperationAlertRepository::class.java)

    @Test
    fun `run deletes only resolved alerts resolved more than 90 days ago and returns how many`() {
        val now = Instant.parse("2026-11-19T00:00:00Z")
        `when`(alerts.deleteByStatusAndActedAtBefore("resolved", Instant.parse("2026-08-21T00:00:00Z"))).thenReturn(4L)

        assertEquals(4L, AlertCleanupService(alerts).run(now))

        verify(alerts).deleteByStatusAndActedAtBefore("resolved", Instant.parse("2026-08-21T00:00:00Z"))
        verifyNoMoreInteractions(alerts)
    }
}
