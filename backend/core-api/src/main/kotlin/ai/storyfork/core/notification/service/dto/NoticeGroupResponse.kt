package ai.storyfork.core.notification.service.dto

import java.time.Instant

/** 같은 종류·대상으로 묶인 알림 한 묶음. 묶음 속 개별 알림은 종류·대상으로 별도 조회한다. */
data class NoticeGroupResponse(
    val kind: String,
    val targetType: String,
    val targetId: String,
    val count: Long,
    val unreadCount: Long,
    val latestAt: Instant,
    val latestSummary: String,
)
