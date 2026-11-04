package ai.storyfork.content.context.service.dto

import ai.storyfork.content.world.service.dto.SettingPayload

data class StoryContextResponse(val title: String, val summary: String, val basisEpisode: Int, val character: String, val settings: List<SettingPayload>, val draft: String, val episodes: List<ContextEpisodeResponse>, val selection: SelectionResponse)
