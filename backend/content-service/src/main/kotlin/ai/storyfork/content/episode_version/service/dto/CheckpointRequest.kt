package ai.storyfork.content.episode_version.service.dto

import ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse
import ai.storyfork.content.world.service.dto.SettingPayload

data class CheckpointRequest(val id: String, val ownerWorkId: String, val sourceWorkId: String, val basisEpisode: Int, val episodes: List<PublishedEpisodeResponse>, val settingsWorldId: String, val settings: List<SettingPayload>)
