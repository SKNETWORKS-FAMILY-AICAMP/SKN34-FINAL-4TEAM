package ai.storyfork.core.credit

import ai.storyfork.core.credit.domain.CreditKind
import ai.storyfork.core.credit.service.CreditReservationCleanupJob
import ai.storyfork.core.credit.service.CreditReservationService
import ai.storyfork.core.credit.service.CreditService
import java.math.BigDecimal
import java.time.Duration
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate

/** 오래 닫히지 않은 예약의 정리(실패 작업 정산 복구)를 PostgreSQL 위에서 확인한다. */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "AUTH_INTEGRATION_TEST", matches = "true")
class CreditReservationCleanupIntegrationTest {
    @Autowired lateinit var credits: CreditService
    @Autowired lateinit var reservations: CreditReservationService
    @Autowired lateinit var jdbc: JdbcTemplate

    private val now = Instant.parse("2026-11-10T01:00:00Z")

    private fun funded(amount: String): UUID {
        val id = UUID.randomUUID()
        jdbc.update("insert into auth_member(id,email,password_hash,nickname) values (?,?,?,?)", id, "${UUID.randomUUID()}@example.invalid", "x", "Reader")
        credits.grant(id, CreditKind.EVENT, BigDecimal(amount), now)
        return id
    }
    private fun key() = "cleanup-${UUID.randomUUID()}"
    private fun status(key: String) = jdbc.queryForObject("select status from credit_reservation where operation_key = ?", String::class.java, key)

    @Test
    fun `a reservation left open past the timeout is released without a charge and newer or settled ones stay`() {
        val m = funded("100")
        val old = key(); val recent = key(); val settled = key()
        reservations.reserve(m, BigDecimal("30"), old, now)
        reservations.reserve(m, BigDecimal("20"), recent, now.plus(Duration.ofMinutes(90)))
        reservations.reserve(m, BigDecimal("10"), settled, now)
        reservations.settle(m, settled, BigDecimal("4"), now)

        val later = now.plus(Duration.ofHours(2))
        CreditReservationCleanupJob(reservations, true, Duration.ofHours(1), 100).runOnce(later)

        assertEquals("RELEASED", status(old))
        assertEquals("RESERVED", status(recent))
        assertEquals("SETTLED", status(settled))
        // 100에서 정산한 4와 아직 예약 중인 20만 빠진다. 해제된 30은 돌아온다.
        assertEquals(0, BigDecimal("76").compareTo(credits.balance(m, later).total))
        assertThrows(IllegalStateException::class.java) { reservations.settle(m, old, BigDecimal("1"), later) }
    }
}
