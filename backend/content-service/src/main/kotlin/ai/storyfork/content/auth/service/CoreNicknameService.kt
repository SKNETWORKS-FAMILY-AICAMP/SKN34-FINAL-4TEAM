package ai.storyfork.content.auth.service

import ai.storyfork.content._common.helper.executeHttpCall
import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.dto.NicknamesPayload
import ai.storyfork.content.auth.client.dto.NicknamesResponse
import ai.storyfork.content.auth.client.exception.CoreAuthException
import org.springframework.stereotype.Service
import org.springframework.web.client.RestClientException

/** Core에 없는 회원(탈퇴·삭제)의 표시명이다. */
const val WITHDRAWN_MEMBER_NAME = "탈퇴한 회원"

private const val CORE_MAX_IDS = 200

/**
 * 작성자·작가 표시명의 정본은 Core 닉네임이다. Content는 닉네임을 저장하지 않고 응답을 만들 때마다 회원 ID 묶음으로 조회한다(API composition).
 * 호출 실패를 성공이나 빈 이름으로 숨기지 않는다.
 */
@Service
class CoreNicknameService(private val client: CoreAuthClient) {
    // ponytail: 캐시·재시도 없음 — Core의 지연·장애가 목록·상세 응답에 그대로 전해진다. 부담이 되면 짧은 TTL 캐시를 둔다.
    /**
     * [ids]의 최신 닉네임을 돌려준다. 중복은 한 번만 보내고 ID가 없으면 호출하지 않으며, Core 상한(200개)을 넘으면 나눠 보낸다.
     * Core에 없는 회원은 결과에 없다. 호출 실패는 [CoreAuthException](503·504·502)이다.
     */
    fun nicknames(ids: Collection<String>): Map<String, String> =
        ids.toSet().chunked(CORE_MAX_IDS).fold(emptyMap<String, String>()) { found, chunk -> found + lookup(chunk) }

    // 이 호출에는 사용자 Bearer가 없으므로 401·403·400도 사용자 인증 실패가 아니라 서비스 연동 실패(502)다.
    private fun lookup(ids: List<String>): Map<String, String> = executeHttpCall(
        onTimeout = { timeout() },
        onUnavailable = { unavailable() },
        onUpstreamError = {
            when (it.statusCode.value()) {
                503 -> unavailable()
                504 -> timeout()
                else -> CoreAuthException(502, "CORE_MEMBER_UPSTREAM_ERROR", "회원 정보 서비스 연동에 실패했습니다.")
            }
        },
        onInvalidResponse = { CoreAuthException(502, "CORE_MEMBER_INVALID_RESPONSE", "회원 정보 서비스 응답을 확인할 수 없습니다.") },
    ) {
        val response: NicknamesResponse? = client.nicknames(NicknamesPayload(ids))
        (response ?: throw RestClientException("Empty nicknames response")).nicknames
    }

    private fun timeout() = CoreAuthException(504, "CORE_MEMBER_TIMEOUT", "회원 정보 서비스 응답 시간이 초과되었습니다.")

    private fun unavailable() = CoreAuthException(503, "CORE_MEMBER_UNAVAILABLE", "회원 정보 서비스를 사용할 수 없습니다.")
}
