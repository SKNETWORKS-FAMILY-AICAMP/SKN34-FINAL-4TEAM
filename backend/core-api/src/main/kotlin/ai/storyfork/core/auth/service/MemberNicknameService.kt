package ai.storyfork.core.auth.service

import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.service.dto.NicknamesResponse
import java.util.UUID
import org.springframework.stereotype.Service

private const val MAX_IDS = 200

/** 내부 서비스(Content)가 회원 UUID 묶음으로 최신 닉네임을 조회한다. 이용 제한 회원의 닉네임도 반환하고 없는 회원은 뺀다. */
@Service
class MemberNicknameService(private val members: MemberRepository) {
    /** 중복은 무시한다. 200개 초과와 null·정규 UUID가 아닌 값은 조회 전에 INVALID(400)다. */
    fun nicknames(ids: List<String?>): NicknamesResponse {
        if (ids.size > MAX_IDS) throw AuthException(AuthException.Reason.INVALID)
        val wanted = ids.map(::parse).toSet()
        return NicknamesResponse(members.findAllById(wanted).associate { it.id.toString() to it.nickname })
    }

    // UUID.fromString은 "1-1-1-1-1" 같은 변형도 받으므로, 응답 키가 요청 문자열과 같도록 정규 형태만 받는다.
    private fun parse(raw: String?): UUID {
        val id = try { UUID.fromString(raw.orEmpty()) } catch (_: IllegalArgumentException) {
            throw AuthException(AuthException.Reason.INVALID)
        }
        if (id.toString() != raw) throw AuthException(AuthException.Reason.INVALID)
        return id
    }
}
