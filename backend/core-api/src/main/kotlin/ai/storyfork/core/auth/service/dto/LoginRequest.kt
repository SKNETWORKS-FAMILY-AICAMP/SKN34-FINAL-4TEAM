package ai.storyfork.core.auth.service.dto

import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size

data class LoginRequest(
    @field:NotBlank @field:Size(max = 254) val email: String,
    @field:NotBlank @field:Size(max = 72) val password: String,
)
