package ai.storyfork.core.credit.repository

import java.time.Instant
import java.util.UUID

/** 소멸 예정 알림 대상(회원과 지급분의 소멸 시각). */
interface ExpiringGrant {
    val memberId: UUID
    val expiresAt: Instant
}
