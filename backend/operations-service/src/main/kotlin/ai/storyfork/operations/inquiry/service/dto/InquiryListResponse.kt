package ai.storyfork.operations.inquiry.service.dto

data class InquiryListResponse(
    val items: List<InquiryResponse>,
    val page: Int,
    val size: Int,
    val totalElements: Long,
    val totalPages: Int,
)
