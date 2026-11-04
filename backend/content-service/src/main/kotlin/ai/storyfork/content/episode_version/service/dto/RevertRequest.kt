package ai.storyfork.content.episode_version.service.dto

import jakarta.validation.constraints.*

data class RevertRequest(@field:Min(0) val revision: Int, @field:NotBlank val versionId: String)
