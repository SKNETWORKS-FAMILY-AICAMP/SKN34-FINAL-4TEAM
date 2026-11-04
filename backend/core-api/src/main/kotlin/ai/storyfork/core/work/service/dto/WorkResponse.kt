package ai.storyfork.core.work.service.dto

import ai.storyfork.core.fork.service.dto.SourceResponse
import ai.storyfork.core.publication.service.dto.PublishedEpisodeResponse
import ai.storyfork.core.episode.service.dto.DraftResponse

data class WorkResponse(val id: String, val title: String, val summary: String, val visibility: String, val allowFork: Boolean, val allowForkPublication: Boolean, val source: SourceResponse?, val episodes: List<PublishedEpisodeResponse>, val draft: DraftResponse?, val hasWritingEpisode: Boolean = true)
