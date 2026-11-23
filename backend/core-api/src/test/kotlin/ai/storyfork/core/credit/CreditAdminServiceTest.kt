package ai.storyfork.core.credit

import ai.storyfork.core.auth.entity.AuthMember
import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.service.AuthException
import ai.storyfork.core.auth.service.AuthVerificationService
import ai.storyfork.core.credit.domain.CreditKind
import ai.storyfork.core.credit.service.CreditAdminService
import ai.storyfork.core.credit.service.CreditService
import ai.storyfork.core.credit.service.InvalidCreditAdjustmentException
import ai.storyfork.core.credit.service.dto.CreditAdjustRequest
import ai.storyfork.core.credit.service.dto.CreditBalanceItem
import ai.storyfork.core.credit.service.dto.CreditBalanceResponse
import ai.storyfork.core.credit.service.dto.CreditHistoryItem
import ai.storyfork.core.credit.service.dto.CreditHistoryResponse
import ai.storyfork.core.credit.service.dto.MemberCreditBalance
import java.math.BigDecimal
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.inOrder
import org.mockito.Mockito.mock
import org.mockito.Mockito.never
import org.mockito.Mockito.verify
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`

/** 운영자 크레딧 서비스의 권한·검증·위임 규칙을 DB 없이 확인한다. 크레딧 장부 규칙은 CreditRevokeTest, HTTP 경계는 CreditAdminApiIntegrationTest가 맡는다. */
class CreditAdminServiceTest {
    private val members = mock(MemberRepository::class.java)
    private val credits = mock(CreditService::class.java)
    private val service = CreditAdminService(credits, members, AuthVerificationService(members, "", ""))
    private val operator = AuthMember(UUID.randomUUID(), "op@example.test", "hash", "운영자", operator = true)
    private val reader = AuthMember(UUID.randomUUID(), "reader@example.test", "hash", "Reader")
    private val target = UUID.randomUUID()
    private val balance = CreditBalanceResponse(BigDecimal("40"), listOf(CreditBalanceItem("operator", BigDecimal("40"), Instant.parse("2026-11-30T15:00:00Z"))))
    private val history = CreditHistoryResponse(listOf(CreditHistoryItem("grant", "operator", BigDecimal("40"), Instant.parse("2026-11-10T01:00:00Z"))))

    init {
        `when`(members.findById(operator.id)).thenReturn(Optional.of(operator))
        `when`(members.findById(reader.id)).thenReturn(Optional.of(reader))
        `when`(members.existsById(target)).thenReturn(true)
        `when`(credits.balance(eq(target), anyTime())).thenReturn(balance)
        `when`(credits.history(target)).thenReturn(history)
    }

    /** Kotlin 비 null 인자에 Mockito 매처의 null이 들어가지 않게 원래 값을 돌려준다. */
    private fun <T : Any> eq(value: T): T = ArgumentMatchers.eq(value) ?: value
    private fun anyTime(): Instant = ArgumentMatchers.any(Instant::class.java) ?: Instant.EPOCH
    private fun anyAmount(): BigDecimal = ArgumentMatchers.any(BigDecimal::class.java) ?: BigDecimal.ZERO

    private val actor = operator.id.toString()
    private fun request(amount: String? = "10", reason: String? = "이벤트 보상") = CreditAdjustRequest(amount?.let(::BigDecimal), reason)
    private fun reason(block: () -> Unit) = assertThrows(AuthException::class.java) { block() }.reason

    @Test
    fun `only an unrestricted operator may use it, and nothing is touched otherwise`() {
        val readerSubject = reader.id.toString()
        assertEquals(AuthException.Reason.FORBIDDEN, reason { service.view(readerSubject, target) })
        assertEquals(AuthException.Reason.FORBIDDEN, reason { service.grant(readerSubject, target, request()) })
        assertEquals(AuthException.Reason.FORBIDDEN, reason { service.revoke(readerSubject, target, request()) })
        assertEquals(AuthException.Reason.FORBIDDEN, reason { service.balances(readerSubject, listOf(target)) })
        assertEquals(AuthException.Reason.UNAUTHENTICATED, reason { service.view(UUID.randomUUID().toString(), target) })
        assertEquals(AuthException.Reason.UNAUTHENTICATED, reason { service.view("not-a-uuid", target) })
        operator.restricted = true
        assertEquals(AuthException.Reason.UNAUTHENTICATED, reason { service.grant(actor, target, request()) })
        verifyNoInteractions(credits)
    }

    @Test
    fun `a member that does not exist is not found before any credit changes`() {
        val ghost = UUID.randomUUID()
        assertEquals(AuthException.Reason.NOT_FOUND, reason { service.view(actor, ghost) })
        assertEquals(AuthException.Reason.NOT_FOUND, reason { service.grant(actor, ghost, request()) })
        assertEquals(AuthException.Reason.NOT_FOUND, reason { service.revoke(actor, ghost, request()) })
        verifyNoInteractions(credits)
    }

    @Test
    fun `the amount must be an integer from 1 to 100000 and the reason 1 to 200 characters after trimming`() {
        val invalid = listOf(request(amount = null), request("0"), request("-1"), request("100001"), request("1.5"), request("0.4"),
            request(reason = null), request(reason = ""), request(reason = "   "), request(reason = "가".repeat(201)))
        for (bad in invalid) {
            assertThrows(InvalidCreditAdjustmentException::class.java) { service.grant(actor, target, bad) }
            assertThrows(InvalidCreditAdjustmentException::class.java) { service.revoke(actor, target, bad) }
        }
        verifyNoInteractions(credits)

        val granted = mutableListOf<BigDecimal>()
        `when`(credits.grant(eq(target), eq(CreditKind.OPERATOR), anyAmount(), anyTime())).thenAnswer {
            granted += it.getArgument<BigDecimal>(2)
            UUID.randomUUID()
        }
        service.grant(actor, target, request("1", " ${"가".repeat(200)} "))
        service.grant(actor, target, request("100000"))
        service.grant(actor, target, request("5.0"))
        assertEquals(listOf(1, 100000, 5), granted.map { it.toInt() })
    }

    @Test
    fun `grant and revoke change the credit first and answer with the balance read afterwards, and view reads balance and history`() {
        assertSame(balance, service.grant(actor, target, request("40")))
        assertSame(balance, service.revoke(actor, target, request("15")))
        val order = inOrder(credits)
        order.verify(credits).grant(eq(target), eq(CreditKind.OPERATOR), eq(BigDecimal("40")), anyTime())
        order.verify(credits).balance(eq(target), anyTime())
        order.verify(credits).revoke(eq(target), eq(BigDecimal("15")), anyTime())
        order.verify(credits).balance(eq(target), anyTime())

        val view = service.view(actor, target)
        assertSame(balance, view.balance)
        assertSame(history, view.history)
    }

    @Test
    fun `balances pairs each member the repository finds with that member's own total`() {
        val other = UUID.randomUUID()
        val ids = listOf(target, other)
        `when`(members.findAllById(ids)).thenReturn(listOf(AuthMember(target, "t@example.test", "hash", "Target"), AuthMember(other, "o@example.test", "hash", "Other")))
        `when`(credits.balance(eq(other), anyTime())).thenReturn(CreditBalanceResponse(BigDecimal("7"), emptyList()))

        assertEquals(listOf(MemberCreditBalance(target, balance.total), MemberCreditBalance(other, BigDecimal("7"))), service.balances(actor, ids))
    }

    @Test
    fun `balances takes at most 100 members and rejects more before reading anything`() {
        val ids = List(101) { UUID.randomUUID() }

        assertThrows(InvalidCreditAdjustmentException::class.java) { service.balances(actor, ids) }
        verify(members, never()).findAllById(ids)
        assertEquals(emptyList<MemberCreditBalance>(), service.balances(actor, ids.take(100)))
    }
}
