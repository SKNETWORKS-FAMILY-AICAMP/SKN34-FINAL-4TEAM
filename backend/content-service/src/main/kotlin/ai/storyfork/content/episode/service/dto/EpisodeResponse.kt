package ai.storyfork.content.episode.service.dto

import ai.storyfork.content.episode_version.service.dto.VersionResponse

data class EpisodeResponse(val number: Int, val draft: DraftResponse, val versions: List<VersionResponse>, val publishedVersionId: String?, val inherited: Boolean, val updatedAt: String?, val checkpointStatus: String = "content_only", val hasDraft: Boolean = true)
