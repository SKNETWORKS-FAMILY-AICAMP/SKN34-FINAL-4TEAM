package ai.storyfork.core.credit

import ai.storyfork.core.credit.domain.CreditExpiry
import ai.storyfork.core.credit.domain.CreditKind
import ai.storyfork.core.credit.domain.InsufficientCreditException
import ai.storyfork.core.credit.entity.CreditGrantEntity
import ai.storyfork.core.credit.entity.CreditLedgerEntryEntity
import ai.storyfork.core.credit.repository.CreditGrantRepository
import ai.storyfork.core.credit.repository.CreditLedgerEntryRepository
import ai.storyfork.core.credit.repository.CreditReservationLineRepository
import ai.storyfork.core.credit.repository.CreditReservationRepository
import ai.storyfork.core.credit.service.CreditService
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.ArgumentCaptor
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyIterable
import org.mockito.Mockito.mock
import org.mockito.Mockito.never
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`

/** 운영자 지급·회수의 장부 규칙(DEC-57)을 DB 없이 확인한다. 실제 제약(V14)과 잔액 계산은 CreditIntegrationTest가 맡는다. */
class CreditRevokeTest {
    private val me = UUID.randomUUID()
    private val now = Instant.parse("2026-11-10T01:00:00Z")
    private val grants = mock(CreditGrantRepository::class.java)
    private val ledger = mock(CreditLedgerEntryRepository::class.java)
    private val lines = mock(CreditReservationLineRepository::class.java)
    private val service = CreditService(grants, ledger, lines, mock(CreditReservationRepository::class.java), BigDecimal.ZERO)
    private val saved = mutableListOf<CreditLedgerEntryEntity>()

    init {
        `when`(ledger.saveAll(anyIterable<CreditLedgerEntryEntity>())).thenAnswer { call ->
            saved += call.getArgument<List<CreditLedgerEntryEntity>>(0)
            call.arguments[0]
        }
    }

    private fun grant(amount: String, expiresAt: String) =
        CreditGrantEntity(UUID.randomUUID(), me, "reward", BigDecimal(amount), now.minusSeconds(60), Instant.parse(expiresAt))

    @Test
    fun `operator grants are stored with the operator kind and expire at the monthly reset like rewards`() {
        `when`(grants.save(any(CreditGrantEntity::class.java))).thenAnswer { it.arguments[0] }

        service.grant(me, CreditKind.OPERATOR, BigDecimal("50"), now)

        val grant = ArgumentCaptor.forClass(CreditGrantEntity::class.java)
        verify(grants).save(grant.capture())
        assertEquals("operator", grant.value.kind)
        assertEquals(0, BigDecimal("50").compareTo(grant.value.amount))
        assertEquals(CreditExpiry.monthly(now), grant.value.expiresAt)
    }

    @Test
    fun `a revoke takes the earliest expiring grant first and records revoke rows under one operator-revoke key`() {
        val early = grant("10", "2026-11-30T15:00:00Z")
        val late = grant("100", "2026-12-10T01:00:00Z")
        `when`(grants.lockActive(me, now)).thenReturn(listOf(late, early))

        service.revoke(me, BigDecimal("15"), now)

        assertEquals(listOf(early.id, late.id), saved.map { it.grantId })
        assertEquals(listOf(10, 5), saved.map { it.amount.toInt() })
        assertTrue(saved.all { it.kind == "revoke" && it.occurredAt == now })
        val key = saved.map { it.operationKey }.toSet().single()
        assertTrue(key.startsWith("operator-revoke:"), key)
        UUID.fromString(key.removePrefix("operator-revoke:"))
    }

    @Test
    fun `revoking above the available balance fails without recording anything`() {
        `when`(grants.lockActive(me, now)).thenReturn(listOf(grant("10", "2026-11-30T15:00:00Z")))

        assertThrows(InsufficientCreditException::class.java) { service.revoke(me, BigDecimal("11"), now) }

        verify(ledger, never()).saveAll(anyIterable<CreditLedgerEntryEntity>())
    }

    @Test
    fun `credit held by a reservation cannot be revoked`() {
        val held = grant("10", "2026-11-30T15:00:00Z")
        `when`(grants.lockActive(me, now)).thenReturn(listOf(held))
        `when`(lines.heldByGrant(listOf(held.id))).thenReturn(listOf(arrayOf<Any>(held.id, BigDecimal("4"))))

        assertThrows(InsufficientCreditException::class.java) { service.revoke(me, BigDecimal("7"), now) }
        assertTrue(saved.isEmpty())
        service.revoke(me, BigDecimal("6"), now)
        assertEquals(listOf(6), saved.map { it.amount.toInt() })
    }
}
