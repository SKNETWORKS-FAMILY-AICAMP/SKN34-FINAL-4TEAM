package ai.storyfork.core.credit.domain

import java.time.Duration
import java.time.Instant
import kotlin.math.ceil

/**
 * 토큰 버킷. 가득 찬 상태로 시작해 초당 [refillPerSecond]씩 차오르고 [capacity]를 넘지 않는다.
 * 시각은 호출하는 쪽이 넘기므로 시계 없이 확인할 수 있다. 스레드 안전하지 않아서 호출하는 쪽이 잠가서 쓴다.
 */
class TokenBucket(val capacity: Double, private val refillPerSecond: Double, start: Instant) {
    init {
        require(capacity > 0 && refillPerSecond > 0) { "버킷 용량과 보충 속도는 0보다 커야 합니다." }
    }

    private var tokens = capacity
    private var updatedAt = start

    private fun refill(now: Instant) {
        if (!now.isAfter(updatedAt)) return
        val seconds = Duration.between(updatedAt, now).toNanos() / 1e9
        tokens = minOf(capacity, tokens + seconds * refillPerSecond)
        updatedAt = now
    }

    /** [amount]를 지금 가져갈 수 있으면 0, 아니면 기다려야 하는 시간(밀리초 단위로 올림). 가져가지는 않는다. */
    fun waitFor(amount: Double, now: Instant): Duration {
        require(amount > 0 && amount <= capacity) { "요청량은 0보다 크고 버킷 용량 이하여야 합니다." }
        refill(now)
        if (tokens + EPSILON >= amount) return Duration.ZERO
        return Duration.ofMillis(maxOf(1L, ceil((amount - tokens) / refillPerSecond * 1000 - EPSILON).toLong()))
    }

    /** [waitFor]가 0을 돌려준 만큼을 가져간다. */
    fun take(amount: Double, now: Instant) {
        refill(now)
        tokens = maxOf(0.0, tokens - amount)
    }

    fun isFull(now: Instant): Boolean {
        refill(now)
        return tokens + EPSILON >= capacity
    }

    private companion object {
        /** 부동소수점 오차 때문에 딱 맞는 대기 시간이 1밀리초 더 길어지거나 한 번 더 거절되지 않게 하는 여유. */
        const val EPSILON = 1e-9
    }
}
