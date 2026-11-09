package ai.storyfork.content.auth.client.dto

/** Core에 최신 닉네임을 물을 회원 UUID 목록이다. Core 상한은 200개이며 중복은 보내지 않는다. */
data class NicknamesPayload(val ids: List<String>)
