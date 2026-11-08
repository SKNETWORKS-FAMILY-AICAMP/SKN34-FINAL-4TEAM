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
    /** 최근 24시간 조회 수. 공개 목록·검색·랭킹 응답에서만 채우고 그 밖에는 0이다. */
    val views: Long = 0,
)
