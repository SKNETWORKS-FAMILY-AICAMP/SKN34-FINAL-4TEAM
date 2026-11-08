package ai.storyfork.core.auth.service.dto

import java.time.Instant

/** status는 진행 중이면 PENDING, 요청이 없으면 NONE이다. 시각은 PENDING일 때만 채운다. */
data class WithdrawalResponse(val status: String, val requestedAt: Instant?, val dueAt: Instant?)
