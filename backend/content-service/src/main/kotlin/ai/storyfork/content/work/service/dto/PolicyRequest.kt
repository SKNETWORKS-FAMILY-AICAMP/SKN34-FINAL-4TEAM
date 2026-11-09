package ai.storyfork.content.work.service.dto

import jakarta.validation.constraints.*

data class PolicyRequest(
    @field:Min(0) val revision: Int,
    val allowFork: Boolean,
    val allowForkPublication: Boolean,
    val episodeScope: String? = null,
    val fromEpisode: Int? = null,
    val episodes: List<Int> = emptyList(),
)
