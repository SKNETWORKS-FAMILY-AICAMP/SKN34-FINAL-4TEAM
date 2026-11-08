package ai.storyfork.operations.inquiry.service.dto

import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size

data class InquiryReplyRequest(
    @field:NotBlank @field:Size(max = 20000) val body: String,
)
