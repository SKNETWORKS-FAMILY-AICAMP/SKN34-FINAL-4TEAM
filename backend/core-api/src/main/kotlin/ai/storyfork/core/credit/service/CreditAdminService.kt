package ai.storyfork.core.credit.service

import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.service.AuthException
import ai.storyfork.core.auth.service.AuthVerificationService
import ai.storyfork.core.credit.domain.CreditKind
import ai.storyfork.core.credit.service.dto.CreditAdjustRequest
import ai.storyfork.core.credit.service.dto.CreditBalanceResponse
import ai.storyfork.core.credit.service.dto.MemberCreditBalance
import ai.storyfork.core.credit.service.dto.MemberCreditsResponse
import java.math.BigDecimal
import java.util.UUID
import org.springframework.stereotype.Service

/** 한 번에 잔액을 물을 수 있는 회원 수. */
private const val MAX_BALANCE_MEMBERS = 100

/** 지급·회수·묶음 잔액 조회 요청의 규칙 위반(금액·사유·회원 수). 컨트롤러가 422 `INVALID_CREDIT_REQUEST`로 바꾼다. */
class InvalidCreditAdjustmentException(message: String) : IllegalArgumentException(message)

/**
 * 운영 서비스가 회원의 크레딧을 조회·수동 지급·수동 회수한다(DEC-57). 호출 회원은 제한되지 않은 operator여야 한다(회원 관리와 같은 규칙).
 * 사유는 규칙만 확인하고 저장하지 않는다. 활동 기록은 운영 서비스가 성공한 뒤에 남긴다.
 */
@Service
class CreditAdminService(
    private val credits: CreditService,
    private val members: MemberRepository,
    private val verification: AuthVerificationService,
) {
    /** 회원의 잔액(지급분별)과 지급·사용·회수·소멸 내역. 없는 회원은 404다. */
    fun view(subject: String?, memberId: UUID): MemberCreditsResponse {
        requireOperator(subject)
        requireMember(memberId)
        return MemberCreditsResponse(credits.balance(memberId), credits.history(memberId))
    }

    /** `operator` 종류로 지급하고 갱신된 잔액을 돌려준다. 소멸은 보상과 같다. */
    fun grant(subject: String?, memberId: UUID, request: CreditAdjustRequest): CreditBalanceResponse {
        requireOperator(subject)
        val amount = validAmount(request)
        requireMember(memberId)
        credits.grant(memberId, CreditKind.OPERATOR, amount)
        return credits.balance(memberId)
    }

    /** 쓸 수 있는 잔액 안에서 회수하고 갱신된 잔액을 돌려준다. 넘으면 [ai.storyfork.core.credit.domain.InsufficientCreditException]이며 아무것도 바꾸지 않는다. */
    fun revoke(subject: String?, memberId: UUID, request: CreditAdjustRequest): CreditBalanceResponse {
        requireOperator(subject)
        val amount = validAmount(request)
        requireMember(memberId)
        credits.revoke(memberId, amount)
        return credits.balance(memberId)
    }

    /**
     * 회원 여러 명의 사용 가능한 크레딧 합계(`balance().total`과 같은 계산)를 돌려준다. 없는 회원은 결과에서 빠지고 순서는 정해져 있지 않다.
     * 100명을 넘으면 아무것도 읽지 않고 [InvalidCreditAdjustmentException]이다.
     */
    fun balances(subject: String?, memberIds: List<UUID>): List<MemberCreditBalance> {
        requireOperator(subject)
        if (memberIds.size > MAX_BALANCE_MEMBERS) throw InvalidCreditAdjustmentException("한 번에 조회할 수 있는 회원은 ${MAX_BALANCE_MEMBERS}명 이하입니다.")
        // ponytail: 회원마다 balance()가 쿼리 3개라 100명이면 약 300개다. 느려지면 지급분·사용량 조회를 회원 목록 일괄 쿼리로 바꾼다.
        return members.findAllById(memberIds).map { MemberCreditBalance(it.id, credits.balance(it.id).total) }
    }

    private fun requireOperator(subject: String?) {
        if (!verification.verify(subject).operator) throw AuthException(AuthException.Reason.FORBIDDEN)
    }

    private fun requireMember(memberId: UUID) {
        if (!members.existsById(memberId)) throw AuthException(AuthException.Reason.NOT_FOUND)
    }

    /** 금액은 1~100000의 정수, 사유는 앞뒤 공백을 뺀 1~200자다. 위반은 [InvalidCreditAdjustmentException]이다. */
    private fun validAmount(request: CreditAdjustRequest): BigDecimal {
        val amount = request.amount
        if (amount == null || amount.signum() <= 0 || amount > BigDecimal(100_000) || amount.stripTrailingZeros().scale() > 0) {
            throw InvalidCreditAdjustmentException("금액은 1 이상 100000 이하의 정수여야 합니다.")
        }
        if (request.reason?.trim()?.length !in 1..200) throw InvalidCreditAdjustmentException("사유는 1자 이상 200자 이하여야 합니다.")
        return amount
    }
}
