package ai.storyfork.core.credit

import ai.storyfork.core.credit.service.AiRateLimitDecision
import ai.storyfork.core.credit.service.AiRateLimitService
import java.time.Duration
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

/** 한도 값을 작게 잡고 시각을 직접 넘겨 요청·토큰·플랫폼 한도를 확인한다. */
class AiRateLimitServiceTest {
    private val t0 = Instant.parse("2026-11-11T00:00:00Z")
    private val me = UUID.randomUUID()
    private val other = UUID.randomUUID()

    private fun service(userRequests: Int = 2, userTokens: Int = 100, platformRequests: Int = 10, platformTokens: Int = 1000) =
        AiRateLimitService(userRequests, userTokens, platformRequests, platformTokens)

    private fun limited(d: AiRateLimitDecision) = (d as AiRateLimitDecision.Limited).retryAfter

    @Test
    fun `a member is limited by requests per minute and told when to retry`() {
        val s = service()
        assertEquals(AiRateLimitDecision.Allowed, s.tryAcquire(me, 1, t0))
        assertEquals(AiRateLimitDecision.Allowed, s.tryAcquire(me, 1, t0))
        assertEquals(Duration.ofSeconds(30), limited(s.tryAcquire(me, 1, t0)))
        assertEquals(Duration.ofSeconds(10), limited(s.tryAcquire(me, 1, t0.plusSeconds(20))))
        assertEquals(AiRateLimitDecision.Allowed, s.tryAcquire(me, 1, t0.plusSeconds(30)))
    }

    @Test
    fun `a member is limited by tokens per minute`() {
        val s = service(userRequests = 10)
        assertEquals(AiRateLimitDecision.Allowed, s.tryAcquire(me, 90, t0))
        // 토큰 10개가 남았고 초당 100/60개가 차오르므로 20개가 되려면 6초가 걸린다.
        assertEquals(Duration.ofSeconds(6), limited(s.tryAcquire(me, 20, t0)))
    }

    @Test
    fun `a limited request takes nothing from any bucket`() {
        val s = service()
        s.tryAcquire(me, 60, t0)
        assertEquals(Duration.ofSeconds(12), limited(s.tryAcquire(me, 60, t0)))
        // 거절된 요청이 요청 수 한도를 쓰지 않았으므로 두 번째 요청이 아직 남아 있다.
        assertEquals(AiRateLimitDecision.Allowed, s.tryAcquire(me, 40, t0))
    }

    @Test
    fun `members do not use each others limits but share the platform limit`() {
        val s = service(userRequests = 5, platformRequests = 2)
        assertEquals(AiRateLimitDecision.Allowed, s.tryAcquire(me, 1, t0))
        assertEquals(AiRateLimitDecision.Allowed, s.tryAcquire(other, 1, t0))
        assertEquals(Duration.ofSeconds(30), limited(s.tryAcquire(UUID.randomUUID(), 1, t0)))
        assertEquals(AiRateLimitDecision.Allowed, s.tryAcquire(me, 1, t0.plusSeconds(30)))
    }

    @Test
    fun `the platform token limit also applies and the longest wait is reported`() {
        val s = service(userRequests = 10, userTokens = 100, platformRequests = 10, platformTokens = 120)
        assertEquals(AiRateLimitDecision.Allowed, s.tryAcquire(me, 100, t0))
        // 플랫폼에는 20개가 남았다. 다른 회원이 50개를 쓰려면 30개가 더 차올라야 하고 초당 2개가 차오르므로 15초다.
        assertEquals(Duration.ofSeconds(15), limited(s.tryAcquire(other, 50, t0)))
    }

    @Test
    fun `requests that can never fit and invalid settings are rejected`() {
        val s = service()
        assertThrows(IllegalArgumentException::class.java) { s.tryAcquire(me, 101, t0) }
        assertThrows(IllegalArgumentException::class.java) { s.tryAcquire(me, 0, t0) }
        assertThrows(IllegalArgumentException::class.java) { AiRateLimitService(0, 100, 10, 1000) }
    }
}
