package ai.storyfork.core.credit

import ai.storyfork.core.credit.domain.TokenBucket
import java.time.Duration
import java.time.Instant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class TokenBucketTest {
    private val t0 = Instant.parse("2026-11-11T00:00:00Z")

    @Test
    fun `starts full and tells how long to wait once empty`() {
        val b = TokenBucket(10.0, 10.0 / 60, t0)
        assertEquals(Duration.ZERO, b.waitFor(10.0, t0))
        b.take(10.0, t0)
        assertEquals(Duration.ofSeconds(6), b.waitFor(1.0, t0))
        assertEquals(Duration.ofSeconds(3), b.waitFor(1.0, t0.plusSeconds(3)))
    }

    @Test
    fun `refills over time but never past its capacity`() {
        val b = TokenBucket(10.0, 10.0 / 60, t0)
        b.take(10.0, t0)
        assertEquals(Duration.ZERO, b.waitFor(5.0, t0.plusSeconds(30)))
        assertTrue(b.isFull(t0.plusSeconds(600)))
        assertEquals(Duration.ZERO, b.waitFor(10.0, t0.plusSeconds(600)))
        assertEquals(Duration.ofSeconds(6), run { b.take(10.0, t0.plusSeconds(600)); b.waitFor(1.0, t0.plusSeconds(600)) })
    }

    @Test
    fun `checking does not take anything and a time that goes backwards changes nothing`() {
        val b = TokenBucket(2.0, 1.0, t0)
        b.waitFor(2.0, t0)
        b.waitFor(2.0, t0)
        b.take(2.0, t0)
        assertFalse(b.isFull(t0.minusSeconds(60)))
        assertEquals(Duration.ofSeconds(1), b.waitFor(1.0, t0.minusSeconds(60)))
    }

    @Test
    fun `rejects amounts that can never fit and invalid settings`() {
        val b = TokenBucket(2.0, 1.0, t0)
        assertThrows(IllegalArgumentException::class.java) { b.waitFor(3.0, t0) }
        assertThrows(IllegalArgumentException::class.java) { b.waitFor(0.0, t0) }
        assertThrows(IllegalArgumentException::class.java) { TokenBucket(0.0, 1.0, t0) }
        assertThrows(IllegalArgumentException::class.java) { TokenBucket(1.0, 0.0, t0) }
    }
}
