package ai.storyfork.core.credit

import ai.storyfork.core.credit.service.CreditReservationCleanupJob
import ai.storyfork.core.credit.service.CreditReservationService
import ai.storyfork.core.credit.service.dto.CreditReservationResponse
import ai.storyfork.core.credit.service.dto.StaleReservation
import java.math.BigDecimal
import java.time.Duration
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.verify
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`

class CreditReservationCleanupJobTest {
    private val now = Instant.parse("2026-11-12T03:00:00Z")
    private val reservations = mock(CreditReservationService::class.java)

    private fun stale(key: String) = StaleReservation(UUID.randomUUID(), UUID.randomUUID(), key)
    private fun released(s: StaleReservation) = CreditReservationResponse(s.id, s.operationKey, "RELEASED", BigDecimal.ONE, null)

    @Test
    fun `disabled job does nothing`() {
        CreditReservationCleanupJob(reservations, false, Duration.ofHours(1), 100).poll()
        verifyNoInteractions(reservations)
    }

    @Test
    fun `reservations older than the timeout are released and one failure does not stop the rest`() {
        val bad = stale("job-a"); val good = stale("job-b")
        `when`(reservations.stale(now.minus(Duration.ofHours(1)), 10)).thenReturn(listOf(bad, good))
        `when`(reservations.release(bad.memberId, bad.operationKey, now)).thenThrow(IllegalStateException("settled"))
        `when`(reservations.release(good.memberId, good.operationKey, now)).thenReturn(released(good))

        assertEquals(1, CreditReservationCleanupJob(reservations, true, Duration.ofHours(1), 10).runOnce(now))
        verify(reservations).release(good.memberId, good.operationKey, now)
    }

    @Test
    fun `a zero or negative timeout and an empty batch are rejected at startup`() {
        assertThrows(IllegalArgumentException::class.java) { CreditReservationCleanupJob(reservations, true, Duration.ZERO, 100) }
        assertThrows(IllegalArgumentException::class.java) { CreditReservationCleanupJob(reservations, true, Duration.ofMinutes(-1), 100) }
        assertThrows(IllegalArgumentException::class.java) { CreditReservationCleanupJob(reservations, true, Duration.ofHours(1), 0) }
    }
}
