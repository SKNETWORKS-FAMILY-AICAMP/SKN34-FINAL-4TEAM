package ai.storyfork.core.auth.service.dto

import jakarta.validation.constraints.Size
import java.util.UUID

/** 내부 서비스의 회원 닉네임 일괄 조회 요청. 한 번에 1~200명까지 받으며 범위 밖이거나 UUID가 아니면 400이다. */
data class NicknamesRequest(@field:Size(min = 1, max = 200) val ids: List<UUID>)
