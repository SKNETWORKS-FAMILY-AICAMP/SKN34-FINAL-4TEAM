package ai.storyfork.core.notification.service.dto

import java.time.Instant

data class NoticeResponse(
    val id: String,
    val kind: String,
    val summary: String,
    val targetType: String?,
    val targetId: String?,
    val createdAt: Instant,
    val read: Boolean,
    /** 회차 단위 알림이면 회차 번호, 아니면 null(#941). */
    val targetEpisode: Int? = null,
)
