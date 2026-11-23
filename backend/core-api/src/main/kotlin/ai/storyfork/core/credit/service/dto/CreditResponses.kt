package ai.storyfork.core.credit.service.dto

import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

/** 지급분 하나의 남은 크레딧과 소멸 예정 시각. */
data class CreditBalanceItem(val kind: String, val remaining: BigDecimal, val expiresAt: Instant)

/** 사용 가능한 크레딧 합계와 지급분별 내역(소멸이 빠른 순). */
data class CreditBalanceResponse(val total: BigDecimal, val items: List<CreditBalanceItem>)

/** 지급·사용·회수·소멸 한 건. type은 `grant`·`spend`·`revoke`·`expire`이고 kind는 지급 종류(가입 체험·운영자 지급 등)다. */
data class CreditHistoryItem(val type: String, val kind: String, val amount: BigDecimal, val occurredAt: Instant)

data class CreditHistoryResponse(val items: List<CreditHistoryItem>)

/** 운영자가 보는 회원의 크레딧: 잔액(`GET /api/v1/me/credits` 응답과 같은 모양)과 내역(`.../history` 응답과 같은 모양). */
data class MemberCreditsResponse(val balance: CreditBalanceResponse, val history: CreditHistoryResponse)

/** 묶음 잔액 조회의 한 회원: 사용 가능한 크레딧 합계. [CreditBalanceResponse.total]과 같은 계산이다. */
data class MemberCreditBalance(val memberId: UUID, val total: BigDecimal)
