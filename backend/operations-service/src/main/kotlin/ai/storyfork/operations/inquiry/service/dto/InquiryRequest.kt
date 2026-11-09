package ai.storyfork.operations.inquiry.service.dto

import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size

data class InquiryRequest(
    @field:NotBlank @field:Size(max = 200) val title: String,
    @field:NotBlank @field:Size(max = 20000) val body: String,
    @field:NotBlank @field:Size(max = 50) val category: String,
)
