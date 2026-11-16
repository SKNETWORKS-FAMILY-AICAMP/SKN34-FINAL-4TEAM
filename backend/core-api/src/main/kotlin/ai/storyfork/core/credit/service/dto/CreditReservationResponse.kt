package ai.storyfork.core.credit.service.dto

import java.math.BigDecimal
import java.util.UUID

/** 예약의 현재 상태. 정산 전에는 settledAmount가 null이다. */
data class CreditReservationResponse(
    val id: UUID,
    val operationKey: String,
    val status: String,
    val reservedAmount: BigDecimal,
    val settledAmount: BigDecimal?,
)
