package ai.storyfork.content.auth.client.dto

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import java.math.BigDecimal

/** Core 크레딧 내부 API 요청이다(docs/design/credit-internal-api.md). 금액은 소수 4자리까지이고 operationKey가 같으면 같은 예약이다. */
data class CreditReservePayload(val memberId: String, val operationKey: String, val amount: BigDecimal)
data class CreditSettlePayload(val memberId: String, val operationKey: String, val actual: BigDecimal)
data class CreditReleasePayload(val memberId: String, val operationKey: String)

/** Core가 돌려주는 예약 상태다. status는 reserved·settled·released이고 id는 trace의 credit_reservation_id에 쓴다. */
@JsonIgnoreProperties(ignoreUnknown = true)
data class CreditReservationResponse(val id: String, val operationKey: String, val status: String, val reservedAmount: BigDecimal, val settledAmount: BigDecimal?)
