package ai.storyfork.core.auth.service.dto

import java.time.Instant
import java.util.UUID

/** 운영 전용 회원 목록·조치 응답 항목. role은 `MEMBER` 또는 `ADMIN`이다. */
data class MemberItem(val id: UUID, val email: String, val nickname: String, val role: String, val restricted: Boolean, val createdAt: Instant)
