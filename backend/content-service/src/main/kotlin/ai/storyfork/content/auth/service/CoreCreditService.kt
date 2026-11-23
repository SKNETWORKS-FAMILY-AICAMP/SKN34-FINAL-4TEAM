package ai.storyfork.content.auth.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.helper.executeHttpCall
import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.dto.CreditReleasePayload
import ai.storyfork.content.auth.client.dto.CreditReservationResponse
import ai.storyfork.content.auth.client.dto.CreditReservePayload
import ai.storyfork.content.auth.client.dto.CreditSettlePayload
import ai.storyfork.content.auth.client.exception.CoreAuthException
import java.math.BigDecimal
import org.springframework.stereotype.Service
import org.springframework.web.client.RestClientException

/**
 * Core 크레딧 내부 API(예약·정산·해제)다. 사용자 Bearer 없이 서비스 자격만 쓰고, 회원 확인과 금액 환산은 호출한 쪽이 끝낸 값을 보낸다.
 * 잔액 부족(409 INSUFFICIENT_CREDIT)은 [ContentFailure]로, 연동 실패는 [CoreAuthException](503·504·502)으로 그대로 알린다. 재시도하지 않는다(같은 operationKey로 다시 불러도 결과는 같다).
 */
@Service
class CoreCreditService(private val client: CoreAuthClient) {
    /** [member]의 크레딧 [amount](상한)를 [key]로 예약하고 예약 id를 돌려준다. 사용 가능 잔액이 모자라면 409 INSUFFICIENT_CREDIT이다. */
    fun reserve(member: String, key: String, amount: BigDecimal): String = call { client.reserveCredit(CreditReservePayload(member, key, amount)) }.id

    /** 예약을 실제 사용량 [actual](0 이상, 예약 상한 이하)로 확정한다. */
    fun settle(member: String, key: String, actual: BigDecimal) {
        call { client.settleCredit(CreditSettlePayload(member, key, actual)) }
    }

    /** 예약을 차감 없이 푼다. */
    fun release(member: String, key: String) {
        call { client.releaseCredit(CreditReleasePayload(member, key)) }
    }

    private fun call(request: () -> CreditReservationResponse?): CreditReservationResponse = executeHttpCall(
        onTimeout = { CoreAuthException(504, "CORE_CREDIT_TIMEOUT", "크레딧 서비스 응답 시간이 초과되었습니다.") },
        onUnavailable = { CoreAuthException(503, "CORE_CREDIT_UNAVAILABLE", "크레딧 서비스를 사용할 수 없습니다.") },
        onUpstreamError = {
            when {
                it.statusCode.value() == 409 && it.responseBodyAsString.contains("INSUFFICIENT_CREDIT") -> ContentFailure(409, "크레딧이 부족합니다.", "INSUFFICIENT_CREDIT")
                it.statusCode.value() == 503 -> CoreAuthException(503, "CORE_CREDIT_UNAVAILABLE", "크레딧 서비스를 사용할 수 없습니다.")
                it.statusCode.value() == 504 -> CoreAuthException(504, "CORE_CREDIT_TIMEOUT", "크레딧 서비스 응답 시간이 초과되었습니다.")
                else -> CoreAuthException(502, "CORE_CREDIT_UPSTREAM_ERROR", "크레딧 서비스 연동에 실패했습니다.")
            }
        },
        onInvalidResponse = { CoreAuthException(502, "CORE_CREDIT_INVALID_RESPONSE", "크레딧 서비스 응답을 확인할 수 없습니다.") },
    ) {
        request() ?: throw RestClientException("Empty credit response")
    }
}
