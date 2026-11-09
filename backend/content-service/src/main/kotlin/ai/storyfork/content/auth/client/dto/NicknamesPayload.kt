package ai.storyfork.content.auth.client.dto

import java.util.UUID

/** Core 닉네임 일괄 조회 요청. Core는 한 번에 1~200개만 받는다. */
data class NicknamesPayload(val ids: List<UUID>)
