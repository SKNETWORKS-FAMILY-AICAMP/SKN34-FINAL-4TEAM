package ai.storyfork.core.credit.service

import ai.storyfork.core.credit.domain.CreditAllocator
import ai.storyfork.core.credit.entity.CreditLedgerEntryEntity
import ai.storyfork.core.credit.entity.CreditReservationEntity
import ai.storyfork.core.credit.entity.CreditReservationLineEntity
import ai.storyfork.core.credit.repository.CreditGrantRepository
import ai.storyfork.core.credit.repository.CreditLedgerEntryRepository
import ai.storyfork.core.credit.repository.CreditReservationLineRepository
import ai.storyfork.core.credit.repository.CreditReservationRepository
import ai.storyfork.core.credit.service.dto.CreditReservationResponse
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * AI 작업의 크레딧 예약·정산·해제(F-CRD-01 v7). 실행 전에 동의한 상한만큼 예약하고, 정산 때 실제 사용량만 차감하며
 * 남은 예약은 푼다. 실패·시간 초과는 해제(차감 없음), 긴 작업이 중간에 멈추면 사용분만 정산한다(F-CRD-03).
 * 예약 중인 양은 직접 차감과 소멸에서 빠지므로 다른 작업이 쓸 수 없다. 같은 [operationKey]로 다시 호출해도 결과가 같다.
 * 호출하는 AI 기능의 계약(작업 식별자·비용 환산)은 아직 없어서 이 서비스는 내부 Kotlin API만 제공한다.
 *
 * shortcut: 예약을 닫는 것은 호출한 쪽의 몫이다. 작업이 비정상 종료돼 settle·release가 오지 않으면 예약이 RESERVED로 남아
 * 그 크레딧은 잔액에서 빠진 채 소멸도 되지 않는다. 첫 호출자를 붙이기 전에 오래된 RESERVED 예약을 해제하는 정리 작업이 필요하다.
 */
@Service
class CreditReservationService(
    private val grants: CreditGrantRepository,
    private val ledger: CreditLedgerEntryRepository,
    private val reservations: CreditReservationRepository,
    private val lines: CreditReservationLineRepository,
    private val credits: CreditService,
) {
    /**
     * 사용 가능한 잔액(잔여−예약)에서 [amount]를 소멸이 빠른 지급분부터 예약한다. 모자라면
     * [ai.storyfork.core.credit.domain.InsufficientCreditException]을 던지며 아무것도 예약하지 않는다.
     * 같은 회원이 같은 키·금액으로 다시 호출하면 새로 예약하지 않고 처음 예약을 돌려준다.
     */
    @Transactional
    fun reserve(memberId: UUID, amount: BigDecimal, operationKey: String, now: Instant = Instant.now()): CreditReservationResponse {
        CreditService.requireOperationKey(operationKey)
        require(amount.signum() > 0) { "예약 크레딧은 0보다 커야 합니다." }
        require(amount.scale() <= AMOUNT_SCALE) { "크레딧은 소수 ${AMOUNT_SCALE}자리까지만 쓸 수 있습니다." }
        // 같은 회원의 동시 예약·차감이 같은 잔액을 두 번 쓰지 않도록 지급분을 먼저 잠근다.
        val active = grants.lockActive(memberId, now)
        reservations.findByOperationKey(operationKey)?.let { existing ->
            require(existing.memberId == memberId) { "이미 다른 작업에 쓰인 operationKey입니다." }
            require(existing.amount.compareTo(amount) == 0) { "같은 operationKey로 다른 금액을 예약할 수 없습니다." }
            return toResponse(existing)
        }
        require(ledger.findByOperationKey(operationKey).isEmpty()) { "이미 차감에 쓰인 operationKey입니다." }
        val allocations = CreditAllocator.allocate(credits.availableBalances(active), amount, now)
        val saved = reservations.save(CreditReservationEntity(UUID.randomUUID(), memberId, operationKey, amount, reservedAt = now))
        lines.saveAll(allocations.map { CreditReservationLineEntity(UUID.randomUUID(), saved.id, it.grantId, it.amount) })
        return toResponse(saved)
    }

    /**
     * 예약을 정산한다. [actual]만 소멸이 빠른 지급분부터 차감하고 나머지 예약은 푼다. [actual]은 0 이상 예약 상한 이하여야 한다.
     * 이미 같은 금액으로 정산했으면 다시 차감하지 않고, 해제한 예약이나 다른 금액의 재정산은 거절한다.
     */
    @Transactional
    fun settle(memberId: UUID, operationKey: String, actual: BigDecimal, now: Instant = Instant.now()): CreditReservationResponse {
        require(actual.signum() >= 0) { "정산 금액은 0 이상이어야 합니다." }
        require(actual.scale() <= AMOUNT_SCALE) { "크레딧은 소수 ${AMOUNT_SCALE}자리까지만 쓸 수 있습니다." }
        val reservation = owned(memberId, operationKey)
        when (reservation.status) {
            CreditReservationEntity.SETTLED -> {
                require(requireNotNull(reservation.settledAmount).compareTo(actual) == 0) { "이미 다른 금액으로 정산한 예약입니다." }
                return toResponse(reservation)
            }
            CreditReservationEntity.RELEASED -> throw IllegalStateException("이미 해제한 예약은 정산할 수 없습니다.")
        }
        require(actual <= reservation.amount) { "정산 금액이 예약 상한을 넘을 수 없습니다." }
        val held = lines.findByReservationId(reservation.id).associate { it.grantId to it.amount }
        var left = actual
        // 소멸이 빠른 지급분부터 쓴다. 소멸 시각이 지난 지급분이어도 예약해 둔 몫은 여기서 차감한다.
        for (grant in grants.lockByIds(held.keys)) {
            if (left.signum() == 0) break
            val take = minOf(held.getValue(grant.id), left)
            ledger.save(CreditLedgerEntryEntity(UUID.randomUUID(), grant.id, "spend", take, operationKey, now))
            left -= take
        }
        check(left.signum() == 0) { "예약해 둔 지급분이 정산 금액보다 적습니다." }
        lines.deleteByReservationId(reservation.id)
        reservation.status = CreditReservationEntity.SETTLED
        reservation.settledAmount = actual
        reservation.resolvedAt = now
        return toResponse(reservation)
    }

    /**
     * 차감 없이 예약을 푼다(실패·시간 초과·비용 확인 단계 취소). 이미 해제했으면 그대로 돌려주고, 정산한 예약은 거절한다.
     */
    @Transactional
    fun release(memberId: UUID, operationKey: String, now: Instant = Instant.now()): CreditReservationResponse {
        val reservation = owned(memberId, operationKey)
        when (reservation.status) {
            CreditReservationEntity.RELEASED -> return toResponse(reservation)
            CreditReservationEntity.SETTLED -> throw IllegalStateException("이미 정산한 예약은 해제할 수 없습니다.")
        }
        // 같은 지급분을 소멸 처리하는 작업과 겹치지 않도록 지급분을 잠근 뒤 푼다.
        grants.lockByIds(lines.findByReservationId(reservation.id).map { it.grantId })
        lines.deleteByReservationId(reservation.id)
        reservation.status = CreditReservationEntity.RELEASED
        reservation.resolvedAt = now
        return toResponse(reservation)
    }

    /** 본인의 예약만 잠가서 읽는다. 없거나 다른 회원의 예약이면 같은 오류다. */
    private fun owned(memberId: UUID, operationKey: String): CreditReservationEntity =
        reservations.lockByOperationKey(operationKey)?.takeIf { it.memberId == memberId } ?: throw NoSuchElementException("예약을 찾을 수 없습니다.")

    private fun toResponse(r: CreditReservationEntity) = CreditReservationResponse(r.id, r.operationKey, r.status, r.amount, r.settledAmount)

    private companion object {
        /** DB 컬럼(numeric(19,4))이 저장하는 소수 자리. 더 길면 반올림돼 같은 입력의 재시도가 다른 금액으로 거절된다. */
        const val AMOUNT_SCALE = 4
    }
}
