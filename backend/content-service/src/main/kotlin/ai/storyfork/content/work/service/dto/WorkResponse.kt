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
    val slug: String? = null, val authorName: String = "작성자", val ownerId: String = "", val revision: Int = 0,
    val theme: String = "star", val hook: String = "", val hanja: String? = null,
    val hero: List<String>? = null, val heroBg: String? = null,
    val forkableEpisodes: List<Int> = emptyList(),
)
