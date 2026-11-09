package ai.storyfork.core.auth.service.dto

/** 닉네임을 조회할 회원 UUID 목록이다. 최대 200개이며 중복은 무시하고, null·정규 UUID가 아닌 값은 400이다. */
data class NicknamesRequest(val ids: List<String?>)
