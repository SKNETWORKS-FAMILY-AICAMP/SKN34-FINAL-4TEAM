package ai.storyfork.core.notification.service.dto

data class NoticeListResponse(val items: List<NoticeResponse>, val nextCursor: String?)
