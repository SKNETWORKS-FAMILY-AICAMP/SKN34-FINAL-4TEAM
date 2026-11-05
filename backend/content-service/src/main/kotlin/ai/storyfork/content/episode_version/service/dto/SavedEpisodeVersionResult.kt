package ai.storyfork.content.episode_version.service.dto
import ai.storyfork.content.episode.service.dto.DraftResponse

data class SavedEpisodeVersionResult(val draft: DraftResponse, val version: VersionResponse)
