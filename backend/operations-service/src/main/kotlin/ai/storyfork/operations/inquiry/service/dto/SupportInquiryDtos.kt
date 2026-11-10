package ai.storyfork.operations.inquiry.service.dto

import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import java.time.Instant
import java.util.UUID

/** Derived from reply presence (WAITING = no reply yet); never stored. */
enum class SupportInquiryStatus { WAITING, ANSWERED }

/** Same limits as [InquiryRequest] and [InquiryReplyRequest]; the service re-checks blank (NBSP-like) and U+0000. */
data class SupportInquiryRequest(
    @field:NotBlank @field:Size(max = 50) val category: String,
    @field:NotBlank @field:Size(max = 200) val title: String,
    @field:NotBlank @field:Size(max = 20000) val body: String,
)

data class SupportReplyRequest(@field:NotBlank @field:Size(max = 20000) val body: String)

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
