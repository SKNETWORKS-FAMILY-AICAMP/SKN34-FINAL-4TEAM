package ai.storyfork.core.episode_version.service.dto
import ai.storyfork.core.episode.service.dto.DraftResponse

data class SavedEpisodeVersionResult(val draft: DraftResponse, val version: VersionResponse)
