package ai.storyfork.operations.inquiry.service.dto

data class InquiryReplyListResponse(
    val items: List<InquiryReplyResponse>,
    val page: Int,
    val size: Int,
    val totalElements: Long,
    val totalPages: Int,
)
