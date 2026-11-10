package ai.storyfork.core.credit.domain

import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

/** 차감 대상이 될 수 있는 지급분의 현재 남은 양. */
data class GrantBalance(
    val id: UUID,
    val remaining: BigDecimal,
    val grantedAt: Instant,
    val expiresAt: Instant,
)

/** 한 지급분에서 얼마를 차감할지. */
data class Allocation(val grantId: UUID, val amount: BigDecimal)

class InsufficientCreditException(val requested: BigDecimal, val available: BigDecimal) :
    RuntimeException("크레딧이 부족합니다. 필요 $requested, 사용 가능 $available")

/** 소멸이 가장 빠른 지급분부터 차감한다. 소멸 시각이 같으면 먼저 지급된 것부터 쓴다. 모자라면 아무것도 차감하지 않는다. */
object CreditAllocator {
    fun allocate(grants: List<GrantBalance>, amount: BigDecimal, now: Instant): List<Allocation> {
        require(amount.signum() > 0) { "차감 크레딧은 0보다 커야 합니다." }
        val usable = grants
            .filter { it.remaining.signum() > 0 && it.expiresAt.isAfter(now) }
            .sortedWith(compareBy<GrantBalance>({ it.expiresAt }, { it.grantedAt }, { it.id }))
        val available = usable.sumOf { it.remaining }
        if (available < amount) throw InsufficientCreditException(amount, available)
        var left = amount
        val result = mutableListOf<Allocation>()
        for (g in usable) {
            if (left.signum() == 0) break
            val take = minOf(g.remaining, left)
            result += Allocation(g.id, take)
            left -= take
        }
        return result
    }
}
