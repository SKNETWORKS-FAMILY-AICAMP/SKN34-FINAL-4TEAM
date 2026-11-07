package ai.storyfork.operations.inquiry.service.dto

import java.time.Instant
import java.util.UUID

data class InquiryResponse(
    val id: UUID,
    val title: String,
    val body: String,
    val category: String,
    val createdAt: Instant,
    val updatedAt: Instant,
)
