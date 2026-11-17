package ai.storyfork.core.credit.service.dto

import java.math.BigDecimal
import java.util.UUID

/** Content가 AI 작업 전에 [amount]만큼 예약한다. 크레딧 환산은 호출한 쪽이 한다. */
data class CreditReserveRequest(val memberId: UUID, val operationKey: String, val amount: BigDecimal)

/** 예약한 작업의 실제 사용량 [actual]만 차감하고 남은 예약을 푼다. */
data class CreditSettleRequest(val memberId: UUID, val operationKey: String, val actual: BigDecimal)

/** 실패·시간 초과·취소한 작업의 예약을 차감 없이 푼다. */
data class CreditReleaseRequest(val memberId: UUID, val operationKey: String)

/** 요청 한 건과 [tokens]만큼 AI를 쓰려는 회원의 요청을 받을지 묻는다. */
data class AiRateLimitRequest(val memberId: UUID, val tokens: Int)

/** 받지 않으면 [retryAfterMillis] 뒤에 다시 시도할 수 있다. 받았으면 null이다. */
data class AiRateLimitResponse(val allowed: Boolean, val retryAfterMillis: Long?)
