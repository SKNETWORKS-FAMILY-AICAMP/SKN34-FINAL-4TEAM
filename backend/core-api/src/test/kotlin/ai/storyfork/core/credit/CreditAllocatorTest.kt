package ai.storyfork.core.credit

import ai.storyfork.core.credit.domain.CreditAllocator
import ai.storyfork.core.credit.domain.GrantBalance
import ai.storyfork.core.credit.domain.InsufficientCreditException
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class CreditAllocatorTest {
    private val now = Instant.parse("2026-11-10T00:00:00Z")
    private fun grant(remaining: String, expiresAt: String, grantedAt: String = "2026-11-01T00:00:00Z") =
        GrantBalance(UUID.randomUUID(), BigDecimal(remaining), Instant.parse(grantedAt), Instant.parse(expiresAt))

    @Test
    fun `spends the grant that expires first`() {
        val late = grant("10", "2026-12-31T00:00:00Z")
        val soon = grant("10", "2026-11-20T00:00:00Z")
        val result = CreditAllocator.allocate(listOf(late, soon), BigDecimal("4"), now)
        assertEquals(listOf(soon.id to BigDecimal("4")), result.map { it.grantId to it.amount })
    }

    @Test
    fun `spills over to the next grant when the first one is not enough`() {
        val soon = grant("3", "2026-11-20T00:00:00Z")
        val late = grant("10", "2026-12-31T00:00:00Z")
        val result = CreditAllocator.allocate(listOf(late, soon), BigDecimal("5"), now)
        assertEquals(listOf(soon.id to BigDecimal("3"), late.id to BigDecimal("2")), result.map { it.grantId to it.amount })
    }

    @Test
    fun `earlier granted credit is spent first when expiry is the same`() {
        val expires = "2026-12-01T00:00:00Z"
        val newer = grant("10", expires, "2026-11-05T00:00:00Z")
        val older = grant("10", expires, "2026-11-02T00:00:00Z")
        val result = CreditAllocator.allocate(listOf(newer, older), BigDecimal("1"), now)
        assertEquals(older.id, result.single().grantId)
    }

    @Test
    fun `expired and empty grants are ignored`() {
        val expired = grant("10", "2026-11-09T23:59:59Z")
        val empty = grant("0", "2026-11-20T00:00:00Z")
        val good = grant("10", "2026-12-31T00:00:00Z")
        val result = CreditAllocator.allocate(listOf(expired, empty, good), BigDecimal("2"), now)
        assertEquals(listOf(good.id), result.map { it.grantId })
    }

    @Test
    fun `a grant expiring exactly now is already expired`() {
        val onTheEdge = grant("10", "2026-11-10T00:00:00Z")
        assertThrows(InsufficientCreditException::class.java) { CreditAllocator.allocate(listOf(onTheEdge), BigDecimal.ONE, now) }
    }

    @Test
    fun `fails without partial spending when the balance is not enough`() {
        val g = grant("3", "2026-12-31T00:00:00Z")
        val e = assertThrows(InsufficientCreditException::class.java) { CreditAllocator.allocate(listOf(g), BigDecimal("4"), now) }
        assertEquals(BigDecimal("3"), e.available)
        assertEquals(BigDecimal("4"), e.requested)
    }

    @Test
    fun `amount must be positive`() {
        val g = grant("3", "2026-12-31T00:00:00Z")
        assertThrows(IllegalArgumentException::class.java) { CreditAllocator.allocate(listOf(g), BigDecimal.ZERO, now) }
        assertThrows(IllegalArgumentException::class.java) { CreditAllocator.allocate(listOf(g), BigDecimal("-1"), now) }
    }
}
