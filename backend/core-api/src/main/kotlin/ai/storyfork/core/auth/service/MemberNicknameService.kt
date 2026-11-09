package ai.storyfork.core.auth.service

import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.service.dto.NicknamesResponse
import java.util.UUID
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** 내부 서비스(Content)가 작가 표시명을 채우도록 회원 닉네임을 한 번에 조회한다. 닉네임 외 회원 정보는 내보내지 않는다. */
@Service
class MemberNicknameService(private val members: MemberRepository) {
    /** 존재하는 회원만 담는다. 이용 제한 회원도 닉네임은 그대로이며, 공개 여부 판단은 호출 서비스 몫이다. */
    @Transactional(readOnly = true)
    fun nicknames(ids: Collection<UUID>): NicknamesResponse =
        NicknamesResponse(members.findAllById(ids.toSet()).associate { it.id to it.nickname })
}
