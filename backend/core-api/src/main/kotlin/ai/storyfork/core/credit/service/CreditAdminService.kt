package ai.storyfork.core.credit.service

import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.service.AuthException
import ai.storyfork.core.auth.service.AuthVerificationService
import ai.storyfork.core.credit.domain.CreditKind
import ai.storyfork.core.credit.service.dto.CreditAdjustRequest
import ai.storyfork.core.credit.service.dto.CreditBalanceResponse
import ai.storyfork.core.credit.service.dto.MemberCreditsResponse
import java.math.BigDecimal
import java.util.UUID
import org.springframework.stereotype.Service

/** 지급·회수 요청의 금액·사유 규칙 위반. 컨트롤러가 422 `INVALID_CREDIT_REQUEST`로 바꾼다. */
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
