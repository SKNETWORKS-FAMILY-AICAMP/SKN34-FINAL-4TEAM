package ai.storyfork.core.auth.service.dto

import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size

data class TokenRequest(@field:NotBlank @field:Size(max = 128) val token: String)
