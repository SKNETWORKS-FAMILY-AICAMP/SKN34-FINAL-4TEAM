package ai.storyfork.core.credit

import ai.storyfork.core.credit.entity.CreditLedgerEntryEntity
import ai.storyfork.core.credit.entity.CreditReservationEntity
import ai.storyfork.core.credit.repository.CreditGrantRepository
import ai.storyfork.core.credit.repository.CreditLedgerEntryRepository
import ai.storyfork.core.credit.repository.CreditReservationLineRepository
import ai.storyfork.core.credit.repository.CreditReservationRepository
import ai.storyfork.core.credit.service.CreditReservationService
import ai.storyfork.core.credit.service.CreditService
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.mock
import org.mockito.Mockito.never
import org.mockito.Mockito.verify
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`

/** 예약·정산·해제의 상태 규칙을 DB 없이 확인한다. 잔액 계산·동시성·소멸과의 상호작용은 CreditReservationIntegrationTest가 맡는다. */
class CreditReservationServiceTest {
    private val me = UUID.randomUUID()
    private val now = Instant.parse("2026-11-11T00:00:00Z")
    private val grants = mock(CreditGrantRepository::class.java)
    private val ledger = mock(CreditLedgerEntryRepository::class.java)
    private val reservations = mock(CreditReservationRepository::class.java)
    private val lines = mock(CreditReservationLineRepository::class.java)
    private val service = CreditReservationService(grants, ledger, reservations, lines, mock(CreditService::class.java))

    private fun reservation(status: String, settled: BigDecimal? = null, owner: UUID = me) =
        CreditReservationEntity(UUID.randomUUID(), owner, "job-1", BigDecimal("10"), status, settled, now.minusSeconds(60), if (status == "RESERVED") null else now)

    private fun stored(r: CreditReservationEntity) = `when`(reservations.lockByOperationKey("job-1")).thenReturn(r)

    @Test
    fun `settling again with the same amount returns the first result and charges nothing`() {
        stored(reservation("SETTLED", BigDecimal("4")))
        assertEquals("SETTLED", service.settle(me, "job-1", BigDecimal("4"), now).status)
        verify(ledger, never()).save(any(CreditLedgerEntryEntity::class.java))
        verifyNoInteractions(lines)
    }

    @Test
    fun `settling again with another amount is rejected`() {
        stored(reservation("SETTLED", BigDecimal("4")))
        assertThrows(IllegalArgumentException::class.java) { service.settle(me, "job-1", BigDecimal("5"), now) }
    }

    @Test
    fun `a released reservation cannot be settled and a settled one cannot be released`() {
        stored(reservation("RELEASED"))
        assertThrows(IllegalStateException::class.java) { service.settle(me, "job-1", BigDecimal("1"), now) }
        stored(reservation("SETTLED", BigDecimal("4")))
        assertThrows(IllegalStateException::class.java) { service.release(me, "job-1", now) }
    }

    @Test
    fun `releasing twice is allowed and settling above the reserved cap is not`() {
        stored(reservation("RELEASED"))
        assertEquals("RELEASED", service.release(me, "job-1", now).status)
        stored(reservation("RESERVED"))
        assertThrows(IllegalArgumentException::class.java) { service.settle(me, "job-1", BigDecimal("11"), now) }
        assertThrows(IllegalArgumentException::class.java) { service.settle(me, "job-1", BigDecimal("-1"), now) }
    }

    @Test
    fun `another members reservation looks like a missing one`() {
        stored(reservation("RESERVED", owner = UUID.randomUUID()))
        assertThrows(NoSuchElementException::class.java) { service.settle(me, "job-1", BigDecimal("1"), now) }
        assertThrows(NoSuchElementException::class.java) { service.release(me, "job-1", now) }
        assertThrows(NoSuchElementException::class.java) { service.release(me, "missing", now) }
    }

    @Test
    fun `reserving needs a valid key and a positive amount before touching any data`() {
        assertThrows(IllegalArgumentException::class.java) { service.reserve(me, BigDecimal("1"), "expire:x", now) }
        assertThrows(IllegalArgumentException::class.java) { service.reserve(me, BigDecimal.ZERO, "job-1", now) }
        verifyNoInteractions(grants)
    }
}
