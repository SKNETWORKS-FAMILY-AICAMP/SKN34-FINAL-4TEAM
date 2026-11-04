package ai.storyfork.core.fork.service.dto

import jakarta.validation.constraints.*

data class ChangeRequest(@field:Min(0) val revision: Int, @field:NotBlank val changeId: String, @field:Pattern(regexp="apply|reject") val decision: String)
