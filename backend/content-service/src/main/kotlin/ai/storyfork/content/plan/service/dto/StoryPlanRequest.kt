package ai.storyfork.content.plan.service.dto

import jakarta.validation.constraints.*

data class StoryPlanRequest(
    val kind: String,
    val parentId: String? = null,
    @field:NotBlank @field:Size(max=120) val title: String,
    @field:Size(max=8000) val content: String = "",
    @field:Min(1) val episodeNumber: Int? = null,
    @field:Size(max=30) val characterIds: List<String> = emptyList(),
    @field:Size(max=30) val placeIds: List<String> = emptyList(),
    @field:Min(0) val revision: Int = 0,
)
