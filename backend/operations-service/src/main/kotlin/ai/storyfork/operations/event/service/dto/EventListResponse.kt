package ai.storyfork.operations.event.service.dto

data class EventListResponse(
    val items: List<EventResponse>,
    val page: Int,
    val size: Int,
    val totalElements: Long,
    val totalPages: Int,
)
