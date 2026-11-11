package ai.storyfork.core.credit

import ai.storyfork.core.credit.domain.CreditKind
import ai.storyfork.core.credit.domain.InsufficientCreditException
import ai.storyfork.core.credit.service.CreditReservationService
import ai.storyfork.core.credit.service.CreditService
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate

/** 크레딧 예약·정산·해제를 PostgreSQL 위에서 확인한다(F-CRD-01 v7, F-CRD-03, F-CRD-04). */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "AUTH_INTEGRATION_TEST", matches = "true")
class CreditReservationIntegrationTest {
    @Autowired lateinit var credits: CreditService
    @Autowired lateinit var reservations: CreditReservationService
    @Autowired lateinit var jdbc: JdbcTemplate

    private val now = Instant.parse("2026-11-10T01:00:00Z")

    private fun member(): UUID {
        val id = UUID.randomUUID()
        jdbc.update("insert into auth_member(id,email,password_hash,nickname) values (?,?,?,?)", id, "${UUID.randomUUID()}@example.invalid", "x", "Reader")
        return id
    }
    private fun funded(amount: String): UUID = member().also { credits.grant(it, CreditKind.EVENT, BigDecimal(amount), now) }
    private fun total(m: UUID, at: Instant = now) = credits.balance(m, at).total
    private fun same(expected: String, actual: BigDecimal) = assertEquals(0, BigDecimal(expected).compareTo(actual), "expected $expected but was $actual")
    private fun count(table: String, m: UUID) = jdbc.queryForObject("select count(*) from $table where member_id = ?", Int::class.java, m)

    @Test
    fun `a reservation holds the cap and settling charges only the actual usage`() {
        val m = funded("100")
        reservations.reserve(m, BigDecimal("30"), "job-a", now)
        same("70", total(m))
        val settled = reservations.settle(m, "job-a", BigDecimal("12"), now.plusSeconds(60))
        assertEquals("SETTLED", settled.status)
        same("88", total(m))
        val history = credits.history(m).items
        assertEquals(listOf("spend", "grant"), history.map { it.type })
        same("12", history.first().amount)
        assertEquals(0, jdbc.queryForObject("select count(*) from credit_reservation_line where reservation_id = ?", Int::class.java, settled.id))
    }

    @Test
    fun `reserving more than the usable balance fails and reserves nothing`() {
        val m = funded("10")
        assertThrows(InsufficientCreditException::class.java) { reservations.reserve(m, BigDecimal("11"), "job-b", now) }
        same("10", total(m))
        assertEquals(0, count("credit_reservation", m))
    }

    @Test
    fun `released reservations give everything back without a charge`() {
        val m = funded("50")
        reservations.reserve(m, BigDecimal("20"), "job-c", now)
        same("30", total(m))
        assertEquals("RELEASED", reservations.release(m, "job-c", now).status)
        assertEquals("RELEASED", reservations.release(m, "job-c", now).status)
        same("50", total(m))
        assertEquals(listOf("grant"), credits.history(m).items.map { it.type })
        assertThrows(IllegalStateException::class.java) { reservations.settle(m, "job-c", BigDecimal("1"), now) }
    }

    @Test
    fun `settling zero gives the whole reservation back`() {
        val m = funded("10")
        reservations.reserve(m, BigDecimal("10"), "job-d", now)
        assertEquals(0, BigDecimal.ZERO.compareTo(reservations.settle(m, "job-d", BigDecimal.ZERO, now).settledAmount))
        same("10", total(m))
    }

    @Test
    fun `reserved credit cannot be spent by another operation`() {
        val m = funded("10")
        reservations.reserve(m, BigDecimal("8"), "job-e", now)
        assertThrows(InsufficientCreditException::class.java) { credits.spend(m, BigDecimal("5"), "other-1", now) }
        credits.spend(m, BigDecimal("2"), "other-2", now)
        assertThrows(InsufficientCreditException::class.java) { reservations.reserve(m, BigDecimal("1"), "job-f", now) }
        reservations.settle(m, "job-e", BigDecimal("8"), now)
        same("0", total(m))
    }

    @Test
    fun `repeating a reservation or a settlement does not charge twice`() {
        val m = funded("40")
        val first = reservations.reserve(m, BigDecimal("15"), "job-g", now)
        assertEquals(first.id, reservations.reserve(m, BigDecimal("15"), "job-g", now).id)
        same("25", total(m))
        assertThrows(IllegalArgumentException::class.java) { reservations.reserve(m, BigDecimal("16"), "job-g", now) }
        reservations.settle(m, "job-g", BigDecimal("6"), now)
        reservations.settle(m, "job-g", BigDecimal("6"), now)
        same("34", total(m))
        assertThrows(IllegalArgumentException::class.java) { reservations.settle(m, "job-g", BigDecimal("7"), now) }
        assertThrows(IllegalStateException::class.java) { reservations.release(m, "job-g", now) }
    }

    @Test
    fun `a key used by another member or by a direct charge is rejected`() {
        val a = funded("10"); val b = funded("10")
        reservations.reserve(a, BigDecimal("1"), "job-h", now)
        assertThrows(IllegalArgumentException::class.java) { reservations.reserve(b, BigDecimal("1"), "job-h", now) }
        assertThrows(NoSuchElementException::class.java) { reservations.settle(b, "job-h", BigDecimal("1"), now) }
        credits.spend(b, BigDecimal("1"), "job-i", now)
        assertThrows(IllegalArgumentException::class.java) { reservations.reserve(b, BigDecimal("1"), "job-i", now) }
        same("9", total(b))
    }

    @Test
    fun `a reservation takes the earliest expiring grant first`() {
        val m = member()
        credits.grantSignupTrial(m, now) // 가입 체험 설정이 0이면 지급되지 않으므로 아래 지급이 유일한 지급이다.
        credits.grant(m, CreditKind.EVENT, BigDecimal("10"), now) // 12월 1일 00:00 KST 소멸
        credits.grant(m, CreditKind.REWARD, BigDecimal("10"), now)
        reservations.reserve(m, BigDecimal("15"), "job-j", now)
        reservations.settle(m, "job-j", BigDecimal("15"), now)
        same("5", total(m))
    }

    @Test
    fun `a grant held by a reservation is not expired until the reservation ends`() {
        val m = member()
        credits.grant(m, CreditKind.REWARD, BigDecimal("10"), now) // 12월 1일 00:00 KST 소멸
        reservations.reserve(m, BigDecimal("6"), "job-k", now)
        val after = Instant.parse("2026-12-01T00:00:00Z")
        credits.expireDue(after)
        assertNull(credits.history(m).items.find { it.type == "expire" })
        reservations.settle(m, "job-k", BigDecimal("4"), after)
        credits.expireDue(after)
        val items = credits.history(m).items
        same("4", items.first { it.type == "spend" }.amount)
        same("6", items.first { it.type == "expire" }.amount)
        same("0", total(m, after))
    }
}
