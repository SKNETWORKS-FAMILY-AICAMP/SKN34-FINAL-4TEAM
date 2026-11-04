package ai.storyfork.content.episode.service.dto

import jakarta.validation.constraints.*

data class DraftRequest(@field:NotBlank @field:Size(max=120) val title: String, @field:Size(max=40000) val body: String, @field:Min(0) val revision: Int)
