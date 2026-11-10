package ai.storyfork.core.auth.service.dto

/** 회원 UUID별 최신 닉네임이다. 없는 회원은 키가 없다. */
data class NicknamesResponse(val nicknames: Map<String, String>)
