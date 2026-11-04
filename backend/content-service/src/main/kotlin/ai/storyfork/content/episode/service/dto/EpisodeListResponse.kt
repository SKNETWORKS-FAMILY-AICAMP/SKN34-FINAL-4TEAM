package ai.storyfork.content.episode.service.dto

import com.fasterxml.jackson.annotation.JsonValue

data class EpisodeListResponse(@get:JsonValue val items: List<EpisodeResponse>)
