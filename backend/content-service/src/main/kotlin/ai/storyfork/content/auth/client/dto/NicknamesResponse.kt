package ai.storyfork.content.auth.client.dto

/** Core가 돌려주는 회원 UUID별 최신 닉네임이다. Core에 없는 회원은 키가 없다. */
data class NicknamesResponse(val nicknames: Map<String, String>)
