package ai.storyfork.core.auth.service.dto

import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size

data class NicknameRequest(@field:NotBlank @field:Size(max = 80) val nickname: String)
