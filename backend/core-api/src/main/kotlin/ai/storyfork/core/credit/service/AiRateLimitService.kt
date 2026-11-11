package ai.storyfork.core.credit.service

import ai.storyfork.core.credit.domain.TokenBucket
import java.time.Duration
import java.time.Instant
import java.util.UUID
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service

/** [AiRateLimitService.tryAcquire]의 결과. 제한에 걸리면 크레딧과 한도를 쓰지 않고 다시 시도할 시점만 알려 준다. */
sealed interface AiRateLimitDecision {
    data object Allowed : AiRateLimitDecision

    data class Limited(val retryAfter: Duration) : AiRateLimitDecision
}

/**
 * AI 요청 속도 제한(F-CRD-05). 회원별 분당 요청 수·토큰 수와 플랫폼 전체 분당 요청 수·토큰 수를 토큰 버킷으로 제한한다.
 * 네 버킷을 모두 통과해야 요청을 받고, 하나라도 모자라면 아무것도 가져가지 않고 가장 늦은 대기 시간을 돌려준다.
 * 한도 값은 설정으로 바꿀 수 있으며, 플랜별 값은 정해지지 않아 모든 회원에게 같은 값을 쓴다.
 * 호출하는 AI 기능이 아직 없어서 이 서비스는 내부 Kotlin API만 제공한다.
 *
 * shortcut: 버킷 상태는 Core 인스턴스 메모리에만 있다. 재시작하면 모두 가득 찬 상태로 돌아가고 인스턴스를 늘리면 한도가 인스턴스마다
 * 따로 적용된다. 알림 SSE 연결과 같이 단일 Core 인스턴스를 전제로 하며, 늘리기 전에 공유 저장소로 옮겨야 한다.
 */
@Service
class AiRateLimitService(
    @param:Value("\${app.ai-rate-limit.user-requests-per-minute:20}") private val userRequests: Int,
    @param:Value("\${app.ai-rate-limit.user-tokens-per-minute:60000}") private val userTokens: Int,
    @param:Value("\${app.ai-rate-limit.platform-requests-per-minute:300}") private val platformRequests: Int,
    @param:Value("\${app.ai-rate-limit.platform-tokens-per-minute:600000}") private val platformTokens: Int,
) {
    private class Limits(val requests: TokenBucket, val tokens: TokenBucket)

    private val lock = Any()
    private val users = HashMap<UUID, Limits>()
    private var platform: Limits? = null

    init {
        require(listOf(userRequests, userTokens, platformRequests, platformTokens).all { it > 0 }) { "속도 제한 값은 0보다 커야 합니다." }
    }

    /**
     * 요청 한 건과 [tokens]만큼의 토큰을 쓰려는 [memberId]의 요청을 받을지 정한다. 받으면 한도를 가져가고,
     * 아니면 아무것도 가져가지 않는다. [tokens]가 분당 한도보다 크면 기다려도 통과할 수 없으므로 거절한다.
     */
    fun tryAcquire(memberId: UUID, tokens: Int, now: Instant = Instant.now()): AiRateLimitDecision {
        require(tokens > 0) { "요청 토큰 수는 0보다 커야 합니다." }
        require(tokens <= userTokens && tokens <= platformTokens) { "요청 토큰 수가 분당 한도보다 큽니다." }
        synchronized(lock) {
            val mine = users.getOrPut(memberId) { limits(userRequests, userTokens, now) }
            val all = platform ?: limits(platformRequests, platformTokens, now).also { platform = it }
            val amount = tokens.toDouble()
            val wait = maxOf(
                mine.requests.waitFor(1.0, now), mine.tokens.waitFor(amount, now),
                all.requests.waitFor(1.0, now), all.tokens.waitFor(amount, now),
            )
            if (!wait.isZero) return AiRateLimitDecision.Limited(wait)
            mine.requests.take(1.0, now)
            mine.tokens.take(amount, now)
            all.requests.take(1.0, now)
            all.tokens.take(amount, now)
            if (users.size > PURGE_THRESHOLD) users.values.removeIf { it.requests.isFull(now) && it.tokens.isFull(now) }
            return AiRateLimitDecision.Allowed
        }
    }

    private fun limits(perMinuteRequests: Int, perMinuteTokens: Int, now: Instant) = Limits(
        TokenBucket(perMinuteRequests.toDouble(), perMinuteRequests / 60.0, now),
        TokenBucket(perMinuteTokens.toDouble(), perMinuteTokens / 60.0, now),
    )

    private companion object {
        /** 회원별 버킷이 이만큼 쌓이면 다시 가득 찬 버킷을 지운다(지워도 새로 만들면 같은 상태다). */
        const val PURGE_THRESHOLD = 10_000
    }
}
