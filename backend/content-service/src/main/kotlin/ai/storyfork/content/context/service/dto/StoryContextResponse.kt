package ai.storyfork.content.context.service.dto

import ai.storyfork.content.world.service.dto.SettingPayload

data class StoryContextResponse(val title: String, val summary: String, val basisEpisode: Int, val character: String, val settings: List<SettingPayload>, val draft: String, val episodes: List<ContextEpisodeResponse>, val selection: SelectionResponse,
    @get:com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
    val recentSource: ai.storyfork.content.context.domain.RecentSource? = null)
