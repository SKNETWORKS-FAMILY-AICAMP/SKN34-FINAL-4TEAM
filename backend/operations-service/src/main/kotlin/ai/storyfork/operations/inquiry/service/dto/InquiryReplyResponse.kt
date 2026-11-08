package ai.storyfork.operations.inquiry.service.dto

import java.time.Instant
import java.util.UUID

data class InquiryReplyResponse(
    val id: UUID,
    val inquiryId: UUID,
    val body: String,
    val createdAt: Instant,
    val updatedAt: Instant,
)
