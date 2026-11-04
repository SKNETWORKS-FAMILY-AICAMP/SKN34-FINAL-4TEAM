package ai.storyfork.content.world.service.dto

import jakarta.validation.Valid
import jakarta.validation.constraints.*

data class SettingRequest(@field:Min(0) val revision: Int, @field:Valid val setting: SettingPayload, @field:NotBlank val sourceToken: String)
