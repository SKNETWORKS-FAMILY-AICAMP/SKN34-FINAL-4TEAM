package ai.storyfork.operations.inquiry.service.dto

import java.time.Instant
import java.util.UUID

/** Derived from reply presence (WAITING = no reply yet); never stored. */
enum class SupportInquiryStatus { WAITING, ANSWERED }

data class SupportInquiryRequest(val category: String, val title: String, val body: String)

data class SupportReplyRequest(val body: String)

data class SupportReplyResponse(val id: UUID, val body: String, val createdAt: Instant, val updatedAt: Instant)

/** `replies` are oldest first. */
data class SupportInquiryResponse(
    val id: UUID,
    val memberId: UUID,
    val category: String,
    val title: String,
    val body: String,
    val status: SupportInquiryStatus,
    val createdAt: Instant,
    val updatedAt: Instant,
    val replies: List<SupportReplyResponse>,
)

data class SupportInquiryListResponse(val items: List<SupportInquiryResponse>)
