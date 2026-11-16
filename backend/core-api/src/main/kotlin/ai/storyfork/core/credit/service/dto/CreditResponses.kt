package ai.storyfork.core.credit.service.dto

import java.math.BigDecimal
import java.time.Instant

/** 지급분 하나의 남은 크레딧과 소멸 예정 시각. */
data class CreditBalanceItem(val kind: String, val remaining: BigDecimal, val expiresAt: Instant)

/** 사용 가능한 크레딧 합계와 지급분별 내역(소멸이 빠른 순). */
data class CreditBalanceResponse(val total: BigDecimal, val items: List<CreditBalanceItem>)

/** 지급·사용·소멸 한 건. type은 `grant`·`spend`·`expire`이고 kind는 지급 종류(가입 체험 등)다. */
data class CreditHistoryItem(val type: String, val kind: String, val amount: BigDecimal, val occurredAt: Instant)

data class CreditHistoryResponse(val items: List<CreditHistoryItem>)
