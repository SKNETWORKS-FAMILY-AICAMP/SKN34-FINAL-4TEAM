package ai.storyfork.core.auth.controller.dto

import jakarta.validation.constraints.Email
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size

data class SignupRequest(
    @field:NotBlank @field:Email @field:Size(max = 254) val email: String,
    @field:NotBlank @field:Size(min = 8, max = 72) val password: String,
    @field:NotBlank @field:Size(max = 80) val nickname: String,
)

data class EmailRequest(@field:NotBlank @field:Email @field:Size(max = 254) val email: String)

data class TokenRequest(@field:NotBlank @field:Size(max = 128) val token: String)

data class VerificationRequest(
    @field:NotBlank @field:Size(max = 128) val token: String,
    @field:NotBlank @field:Size(min = 8, max = 72) val password: String,
)
