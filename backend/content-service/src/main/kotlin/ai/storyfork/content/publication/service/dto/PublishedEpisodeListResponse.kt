package ai.storyfork.content.publication.service.dto

import com.fasterxml.jackson.annotation.JsonValue

data class PublishedEpisodeListResponse(@get:JsonValue val items: List<PublishedEpisodeResponse>)
