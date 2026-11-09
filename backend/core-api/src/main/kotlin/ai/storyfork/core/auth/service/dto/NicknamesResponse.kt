package ai.storyfork.core.auth.service.dto

import java.util.UUID

/** 닉네임 일괄 조회 응답. 키는 회원 UUID이고 존재하지 않는 회원은 담지 않는다. */
data class NicknamesResponse(val nicknames: Map<UUID, String>)
