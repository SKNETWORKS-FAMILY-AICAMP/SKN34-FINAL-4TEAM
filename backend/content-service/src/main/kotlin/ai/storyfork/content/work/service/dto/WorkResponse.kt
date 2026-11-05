package ai.storyfork.content.work.service.dto

import ai.storyfork.content.fork.service.dto.SourceResponse
import ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse
import ai.storyfork.content.episode.service.dto.DraftResponse

data class WorkResponse(
    val id: String, val title: String, val summary: String, val visibility: String,
    val allowFork: Boolean, val allowForkPublication: Boolean, val source: SourceResponse?,
    val episodes: List<PublishedEpisodeResponse>, val draft: DraftResponse?,
    val hasWritingEpisode: Boolean = true,
    val creationType: String = "ORIGINAL", val genres: List<String> = emptyList(), val hashtags: List<String> = emptyList(),
)
