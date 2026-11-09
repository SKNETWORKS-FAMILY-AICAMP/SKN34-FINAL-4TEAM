package ai.storyfork.content.auth.client.dto

/** Core 닉네임 일괄 조회 응답. 키는 회원 UUID 문자열이며 Core에 없는 회원은 담기지 않는다. */
data class NicknamesResult(val nicknames: Map<String, String>)
