package ai.storyfork.operations.notice.service.dto

/** Spring Page·엔티티를 직렬화하지 않는 크기 제한 공지 목록이다. */
data class NoticeListResponse(
    val items: List<NoticeResponse>,
    val page: Int,
    val size: Int,
    val totalElements: Long,
    val totalPages: Int,
)
