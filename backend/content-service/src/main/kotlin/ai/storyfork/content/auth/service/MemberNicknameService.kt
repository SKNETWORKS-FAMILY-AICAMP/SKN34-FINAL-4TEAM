package ai.storyfork.content.auth.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.helper.executeHttpCall
import ai.storyfork.content.auth.client.CoreMemberClient
import ai.storyfork.content.auth.client.dto.NicknamesPayload
import ai.storyfork.content.auth.client.dto.NicknamesResult
import java.util.UUID
import org.springframework.stereotype.Service
import org.springframework.web.client.RestClientException

/** 작품 소유자의 Core 닉네임을 일괄 조회한다. 회원 정본과 닉네임 사본은 Content에 두지 않고 응답을 만들 때마다 Core에서 가져온다. */
@Service
class MemberNicknameService(private val client: CoreMemberClient) {
    /**
     * [ownerIds] 중 Core가 아는 회원의 닉네임만 `소유자 id → 닉네임`으로 돌려준다. 호출자는 응답 하나에 소유자 ID를 모아 한 번만 부른다.
     * Core 회원 ID는 UUID라 UUID가 아닌 소유자는 보내지 않고, Core 실패는 어떤 이름으로도 대신하지 않고 전부 503이다.
     */
    fun nicknames(ownerIds: Collection<String>): Map<String, String> {
        val ids = ownerIds.mapNotNull { id -> try { UUID.fromString(id) } catch (_: IllegalArgumentException) { null } }.distinct()
        // Core 요청 한도(200)를 넘는 소유자 수는 나눠 보낸다. 한 조각이라도 실패하면 일부만 채우지 않고 전체를 실패시킨다.
        return ids.chunked(CORE_LIMIT).fold(emptyMap()) { found, chunk -> found + lookup(chunk) }
    }

    private fun lookup(ids: List<UUID>): Map<String, String> {
        val unavailable = { _: Throwable -> ContentFailure(503, "작가 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.") }
        return executeHttpCall(onTimeout = unavailable, onUnavailable = unavailable, onUpstreamError = unavailable, onInvalidResponse = unavailable) {
            val result: NicknamesResult? = client.nicknames(NicknamesPayload(ids))
            result?.nicknames ?: throw RestClientException("Empty nickname response")
        }
    }

    private companion object { const val CORE_LIMIT = 200 }
}
