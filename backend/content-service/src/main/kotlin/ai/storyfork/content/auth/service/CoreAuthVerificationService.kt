package ai.storyfork.content.auth.service

import ai.storyfork.content._common.helper.executeHttpCall
import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
import ai.storyfork.content.auth.client.exception.CoreAuthException
import org.springframework.stereotype.Service

@Service
class CoreAuthVerificationService(private val client: CoreAuthClient) {
    /** Core가 확인한 회원 UUID와 표시용 닉네임이다. 응답 본문이 비면 잘못된 응답(502)이다. */
    fun verify(authorization: String): VerifiedMemberResponse = executeHttpCall(
        onTimeout = { CoreAuthException(504, "CORE_AUTH_TIMEOUT", "인증 서비스 응답 시간이 초과되었습니다.") },
        onUnavailable = { CoreAuthException(503, "CORE_AUTH_UNAVAILABLE", "인증 서비스를 사용할 수 없습니다.") },
        onUpstreamError = {
            when (it.statusCode.value()) {
                401 -> CoreAuthException(401, "UNAUTHORIZED", "서버 인증이 필요합니다.")
                503 -> CoreAuthException(503, "CORE_AUTH_UNAVAILABLE", "인증 서비스를 사용할 수 없습니다.")
                504 -> CoreAuthException(504, "CORE_AUTH_TIMEOUT", "인증 서비스 응답 시간이 초과되었습니다.")
                else -> CoreAuthException(502, "CORE_AUTH_UPSTREAM_ERROR", "인증 서비스 연동에 실패했습니다.")
            }
        },
        onInvalidResponse = { CoreAuthException(502, "CORE_AUTH_INVALID_RESPONSE", "인증 서비스 응답을 확인할 수 없습니다.") },
    ) {
        val response: VerifiedMemberResponse? = client.verify(authorization)
        response ?: throw org.springframework.web.client.RestClientException("Empty verification response")
    }
}
