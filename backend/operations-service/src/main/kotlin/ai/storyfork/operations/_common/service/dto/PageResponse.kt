package ai.storyfork.operations._common.service.dto

import org.springframework.data.domain.Page

/** Spring Page·엔티티를 직렬화하지 않는 크기 제한 목록 응답이다. */
data class PageResponse<T>(
    val items: List<T>,
    val page: Int,
    val size: Int,
    val totalElements: Long,
    val totalPages: Int,
)

fun <E : Any, T> Page<E>.toResponse(map: (E) -> T) = PageResponse(content.map(map), number, size, totalElements, totalPages)
