package ai.storyfork.content.plan.service.dto

import com.fasterxml.jackson.annotation.JsonValue

data class StoryPlanListResponse(@get:JsonValue val items: List<StoryPlanResponse>)
