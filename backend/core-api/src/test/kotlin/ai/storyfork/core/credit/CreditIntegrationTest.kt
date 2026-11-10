package ai.storyfork.core.credit

import ai.storyfork.core.credit.domain.CreditKind
import ai.storyfork.core.credit.domain.InsufficientCreditException
import ai.storyfork.core.credit.service.CreditService
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.TestPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = ["app.credit.signup-trial-amount=100"])
@EnabledIfEnvironmentVariable(named = "AUTH_INTEGRATION_TEST", matches = "true")
class CreditIntegrationTest {
    @Autowired lateinit var credits: CreditService
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var mvc: MockMvc

    private val now = Instant.parse("2026-11-10T01:00:00Z")

    private fun member(): UUID {
        val id = UUID.randomUUID()
        jdbc.update("insert into auth_member(id,email,password_hash,nickname) values (?,?,?,?)", id, "${UUID.randomUUID()}@example.invalid", "x", "Reader")
        return id
    }

    @Test
    fun `signup trial is granted once and expires after 30 days`() {
        val m = member()
        credits.grantSignupTrial(m, now)
        credits.grantSignupTrial(m, now)
        val balance = credits.balance(m, now)
        assertEquals(0, BigDecimal("100").compareTo(balance.total))
        assertEquals(Instant.parse("2026-12-10T01:00:00Z"), balance.items.single().expiresAt)
        assertEquals("signup-trial", balance.items.single().kind)
    }

    @Test
    fun `spend takes the earliest expiring grant first and a repeated operation key does not charge twice`() {
        val m = member()
        credits.grantSignupTrial(m, now) // 100, 12월 10일 소멸
        credits.grant(m, CreditKind.REWARD, BigDecimal("10"), now) // 10, 12월 1일 00:00 KST 소멸 -> 먼저 쓴다
        val first = credits.spend(m, BigDecimal("15"), "job-1", now)
        val again = credits.spend(m, BigDecimal("15"), "job-1", now)
        assertEquals(first.map { it.grantId to it.amount.stripTrailingZeros() }, again.map { it.grantId to it.amount.stripTrailingZeros() })
        assertEquals(2, first.size)
        assertEquals(0, BigDecimal("95").compareTo(credits.balance(m, now).total))
    }

    @Test
    fun `an operation key already used by another member is rejected`() {
        val a = member()
        val b = member()
        credits.grant(a, CreditKind.EVENT, BigDecimal("5"), now)
        credits.grant(b, CreditKind.EVENT, BigDecimal("5"), now)
        credits.spend(a, BigDecimal("1"), "shared-key", now)
        assertThrows(IllegalArgumentException::class.java) { credits.spend(b, BigDecimal("1"), "shared-key", now) }
        assertEquals(0, BigDecimal("5").compareTo(credits.balance(b, now).total))
    }

    @Test
    fun `repeating an operation key with a different amount is rejected`() {
        val m = member()
        credits.grant(m, CreditKind.EVENT, BigDecimal("50"), now)
        credits.spend(m, BigDecimal("5"), "job-5", now)
        assertThrows(IllegalArgumentException::class.java) { credits.spend(m, BigDecimal("50"), "job-5", now) }
        assertEquals(0, BigDecimal("45").compareTo(credits.balance(m, now).total))
    }

    @Test
    fun `operation keys reserved for expiry records are rejected`() {
        val m = member()
        credits.grant(m, CreditKind.EVENT, BigDecimal("5"), now)
        assertThrows(IllegalArgumentException::class.java) { credits.spend(m, BigDecimal("1"), "expire:${UUID.randomUUID()}", now) }
    }

    @Test
    fun `spend fails without charging when the balance is not enough`() {
        val m = member()
        credits.grant(m, CreditKind.EVENT, BigDecimal("5"), now)
        assertThrows(InsufficientCreditException::class.java) { credits.spend(m, BigDecimal("6"), "job-2", now) }
        assertEquals(0, BigDecimal("5").compareTo(credits.balance(m, now).total))
    }

    @Test
    fun `expiry records only the remaining amount once and expired credit is not usable`() {
        val m = member()
        credits.grant(m, CreditKind.REWARD, BigDecimal("10"), now) // 12월 1일 00:00 KST 소멸
        credits.spend(m, BigDecimal("4"), "job-3", now)
        val after = Instant.parse("2026-12-01T00:00:00Z")
        assertTrue(credits.expireDue(after) >= 1)
        assertEquals(0, credits.expireDue(after))
        assertEquals(0, BigDecimal.ZERO.compareTo(credits.balance(m, after).total))
        val types = credits.history(m).items.map { it.type }.toSet()
        assertEquals(setOf("grant", "spend", "expire"), types)
    }

    @Test
    fun `credit endpoints require login`() {
        mvc.perform(get("/api/v1/me/credits")).andExpect(status().isUnauthorized())
        mvc.perform(get("/api/v1/me/credits/history")).andExpect(status().isUnauthorized())
    }
}
