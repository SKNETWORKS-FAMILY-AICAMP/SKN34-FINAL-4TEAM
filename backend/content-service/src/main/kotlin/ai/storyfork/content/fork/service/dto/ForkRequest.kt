package ai.storyfork.content.fork.service.dto

import jakarta.validation.constraints.*

data class ForkRequest(@field:Min(1) val episode: Int, @field:NotBlank @field:Size(max=120) val title: String, @field:Size(max=2000) val summary: String = "", @field:Size(max=2000) val direction: String = "")
