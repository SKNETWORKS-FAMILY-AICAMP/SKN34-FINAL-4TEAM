package ai.storyfork.core.credit

import ai.storyfork.core.credit.domain.CreditExpiry
import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class CreditExpiryTest {
    @Test
    fun `signup trial expires 30 days after it is granted`() {
        val granted = Instant.parse("2026-11-10T01:00:00Z")
        assertEquals(Instant.parse("2026-12-10T01:00:00Z"), CreditExpiry.signupTrial(granted))
    }

    @Test
    fun `monthly credit expires at 00시 KST on the first day of the next month`() {
        // 2026-11-10 KST -> 2026-12-01 00:00 KST = 2026-11-30T15:00:00Z
        assertEquals(Instant.parse("2026-11-30T15:00:00Z"), CreditExpiry.monthly(Instant.parse("2026-11-10T01:00:00Z")))
    }

    @Test
    fun `monthly credit granted late on the last day in KST still resets on the next first`() {
        // 2026-11-30 23:30 KST = 2026-11-30T14:30:00Z -> 2026-12-01 00:00 KST
        assertEquals(Instant.parse("2026-11-30T15:00:00Z"), CreditExpiry.monthly(Instant.parse("2026-11-30T14:30:00Z")))
    }

    @Test
    fun `monthly credit granted exactly at the KST month start expires one month later`() {
        // 2026-12-01 00:00 KST = 2026-11-30T15:00:00Z -> 2027-01-01 00:00 KST
        assertEquals(Instant.parse("2026-12-31T15:00:00Z"), CreditExpiry.monthly(Instant.parse("2026-11-30T15:00:00Z")))
    }
}
