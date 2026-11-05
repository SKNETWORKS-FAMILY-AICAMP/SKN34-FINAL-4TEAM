package ai.storyfork.content.episode.service.dto

import jakarta.validation.constraints.*

data class CreateEpisodeRequest(@field:NotBlank @field:Size(max=120) val title: String)
