package ai.storyfork.core.episode.service.dto

import ai.storyfork.core.episode_version.service.dto.VersionResponse

data class EpisodeResponse(val number: Int, val draft: DraftResponse, val versions: List<VersionResponse>, val publishedVersionId: String?, val inherited: Boolean, val updatedAt: String?, val checkpointStatus: String = "content_only")
