package ai.storyfork.content.plan.service.dto

data class StoryPlanResponse(
    val id: String, val workId: String, val kind: String, val parentId: String?,
    val title: String, val content: String, val episodeNumber: Int?, val episodeMissing: Boolean,
    val characterIds: List<String>, val placeIds: List<String>, val revision: Int,
)
