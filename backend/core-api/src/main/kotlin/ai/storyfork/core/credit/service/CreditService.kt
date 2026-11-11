package ai.storyfork.core.credit.service

import ai.storyfork.core.credit.domain.Allocation
import ai.storyfork.core.credit.domain.CreditAllocator
import ai.storyfork.core.credit.domain.CreditExpiry
import ai.storyfork.core.credit.domain.CreditKind
import ai.storyfork.core.credit.domain.GrantBalance
import ai.storyfork.core.credit.entity.CreditGrantEntity
import ai.storyfork.core.credit.entity.CreditLedgerEntryEntity
import ai.storyfork.core.credit.repository.CreditGrantRepository
import ai.storyfork.core.credit.repository.CreditLedgerEntryRepository
import ai.storyfork.core.credit.repository.CreditReservationLineRepository
import ai.storyfork.core.credit.service.dto.CreditBalanceItem
import ai.storyfork.core.credit.service.dto.CreditBalanceResponse
import ai.storyfork.core.credit.service.dto.CreditHistoryItem
import ai.storyfork.core.credit.service.dto.CreditHistoryResponse
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** 크레딧 지급·잔액 조회·차감·소멸 기록. 잔액은 지급분에서 장부의 사용·소멸 합계와 예약 중인 양을 뺀 값이다. */
@Service
class CreditService(
    private val grants: CreditGrantRepository,
    private val ledger: CreditLedgerEntryRepository,
    private val lines: CreditReservationLineRepository,
    /** 가입 체험 지급량. 팀 결정 전이라 기본 0(지급하지 않음)이며 CREDIT_SIGNUP_TRIAL_AMOUNT로 정한다. */
    @param:Value("\${app.credit.signup-trial-amount:0}") private val signupTrialAmount: BigDecimal,
) {
    /** 가입 체험 크레딧을 회원당 한 번 지급한다. 지급량이 0이거나 이미 받았으면 아무것도 하지 않는다. */
    @Transactional
    fun grantSignupTrial(memberId: UUID, now: Instant = Instant.now()) {
        if (signupTrialAmount.signum() <= 0) return
        if (grants.existsByMemberIdAndKind(memberId, CreditKind.SIGNUP_TRIAL.code)) return
        grants.save(CreditGrantEntity(UUID.randomUUID(), memberId, CreditKind.SIGNUP_TRIAL.code, signupTrialAmount, now, CreditExpiry.signupTrial(now)))
    }

    /** 보상·이벤트 크레딧을 지급한다. 소멸은 지급한 달의 월간 초기화 시점이다. 가입 체험은 [grantSignupTrial]로만 지급한다. */
    @Transactional
    fun grant(memberId: UUID, kind: CreditKind, amount: BigDecimal, now: Instant = Instant.now()): UUID {
        require(kind != CreditKind.SIGNUP_TRIAL) { "가입 체험 크레딧은 가입 시에만 지급합니다." }
        require(amount.signum() > 0) { "지급 크레딧은 0보다 커야 합니다." }
        return grants.save(CreditGrantEntity(UUID.randomUUID(), memberId, kind.code, amount, now, CreditExpiry.monthly(now))).id
    }

    @Transactional(readOnly = true)
    fun balance(memberId: UUID, now: Instant = Instant.now()): CreditBalanceResponse {
        val active = grants.findActive(memberId, now)
        val used = usedByGrant(active.map { it.id })
        val items = active.mapNotNull { g ->
            val remaining = g.amount - (used[g.id] ?: BigDecimal.ZERO)
            if (remaining.signum() > 0) CreditBalanceItem(g.kind, remaining, g.expiresAt) else null
        }
        return CreditBalanceResponse(items.sumOf { it.remaining }, items)
    }

    /** 지급·사용·소멸 내역을 최신순으로 반환한다. */
    @Transactional(readOnly = true)
    fun history(memberId: UUID): CreditHistoryResponse {
        val granted = grants.history(memberId)
        val kindByGrant = granted.associate { it.id to it.kind }
        val items = granted.map { CreditHistoryItem("grant", it.kind, it.amount, it.grantedAt) } +
            ledger.history(memberId).map { CreditHistoryItem(it.kind, kindByGrant.getValue(it.grantId), it.amount, it.occurredAt) }
        return CreditHistoryResponse(items.sortedByDescending { it.occurredAt })
    }

    /**
     * 소멸이 빠른 지급분부터 [amount]만큼 차감한다. 같은 [operationKey]로 다시 호출하면 새로 차감하지 않고 처음 결과를 돌려준다.
     * 잔액이 모자라면 [ai.storyfork.core.credit.domain.InsufficientCreditException]을 던지며 아무것도 차감하지 않는다.
     */
    @Transactional
    fun spend(memberId: UUID, amount: BigDecimal, operationKey: String, now: Instant = Instant.now()): List<Allocation> {
        requireOperationKey(operationKey)
        // 같은 회원의 동시 호출이 같은 작업을 두 번 차감하지 않도록, 먼저 지급분을 잠근 뒤 같은 작업의 기록을 확인한다.
        val active = grants.lockActive(memberId, now)
        // 소멸 기록은 "expire:" 키만 쓰고 차감은 그 접두사를 거절하므로, 이 키로 남은 기록은 모두 차감이다.
        val previous = ledger.findByOperationKey(operationKey)
        if (previous.isNotEmpty()) {
            // 같은 키가 다른 회원의 차감이면 그 결과를 돌려주지 않는다.
            require(grants.findAllById(previous.map { it.grantId }).all { it.memberId == memberId }) { "이미 다른 작업에 쓰인 operationKey입니다." }
            require(previous.sumOf { it.amount }.compareTo(amount) == 0) { "같은 operationKey로 다른 금액을 차감할 수 없습니다." }
            return previous.map { Allocation(it.grantId, it.amount) }
        }
        val used = usedByGrant(active.map { it.id })
        val balances = active.map { g ->
            GrantBalance(g.id, g.amount - (used[g.id] ?: BigDecimal.ZERO), g.grantedAt, g.expiresAt)
        }
        val allocations = CreditAllocator.allocate(balances, amount, now)
        ledger.saveAll(allocations.map { CreditLedgerEntryEntity(UUID.randomUUID(), it.grantId, "spend", it.amount, operationKey, now) })
        return allocations
    }

    /** 소멸 시각이 지난 지급분의 남은 양을 소멸로 기록한다. 이미 기록한 지급분은 건너뛴다. 기록한 건수를 반환한다. */
    @Transactional
    fun expireDue(now: Instant = Instant.now()): Int {
        val due = grants.expiredWithoutRecord(now)
        val used = usedByGrant(due.map { it.id })
        var recorded = 0
        for (g in due) {
            val remaining = g.amount - (used[g.id] ?: BigDecimal.ZERO)
            if (remaining.signum() > 0) {
                ledger.save(CreditLedgerEntryEntity(UUID.randomUUID(), g.id, "expire", remaining, "expire:${g.id}", now))
                recorded++
            }
        }
        return recorded
    }

    /** 지급분마다 사용 가능한 남은 양(지급량 − 사용·소멸 − 예약 중). 예약 서비스가 예약 가능 여부를 계산할 때 쓴다. */
    fun availableBalances(active: List<CreditGrantEntity>): List<GrantBalance> {
        val used = usedByGrant(active.map { it.id })
        return active.map { g -> GrantBalance(g.id, g.amount - (used[g.id] ?: BigDecimal.ZERO), g.grantedAt, g.expiresAt) }
    }

    /** 지급분별로 이미 빠져나간 양(사용·소멸)에 예약 중인 양을 더한 값. 다른 작업이 쓸 수 없는 몫이다. */
    private fun usedByGrant(ids: List<UUID>): Map<UUID, BigDecimal> {
        if (ids.isEmpty()) return emptyMap()
        val used = ledger.usedByGrant(ids).associate { it[0] as UUID to it[1] as BigDecimal }
        val held = lines.heldByGrant(ids).associate { it[0] as UUID to it[1] as BigDecimal }
        return (used.keys + held.keys).associateWith { (used[it] ?: BigDecimal.ZERO) + (held[it] ?: BigDecimal.ZERO) }
    }

    companion object {
        /** 작업 키는 비어 있거나 100자를 넘거나 소멸 기록 전용 접두사(`expire:`)로 시작할 수 없다. */
        fun requireOperationKey(operationKey: String) =
            require(operationKey.isNotBlank() && operationKey.length <= 100 && !operationKey.startsWith("expire:")) { "operationKey가 올바르지 않습니다." }
    }
}
