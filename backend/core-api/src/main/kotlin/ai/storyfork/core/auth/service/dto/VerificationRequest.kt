package ai.storyfork.core.auth.service.dto

import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size

data class VerificationRequest(
    @field:NotBlank @field:Size(max = 128) val token: String,
    @field:NotBlank @field:Size(min = 8, max = 72) val password: String,
)
