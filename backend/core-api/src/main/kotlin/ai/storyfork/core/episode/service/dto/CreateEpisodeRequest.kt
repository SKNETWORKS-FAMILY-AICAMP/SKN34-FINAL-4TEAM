package ai.storyfork.core.episode.service.dto

import jakarta.validation.constraints.*

data class CreateEpisodeRequest(@field:NotBlank @field:Size(max=120) val title: String)
