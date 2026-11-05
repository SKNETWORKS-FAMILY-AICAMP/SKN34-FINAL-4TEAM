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
)
