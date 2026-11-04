package ai.storyfork.core.episode_version.service.dto

import ai.storyfork.core.publication.service.dto.PublishedEpisodeResponse
import ai.storyfork.core.world.service.dto.SettingPayload

data class CheckpointRequest(val id: String, val ownerWorkId: String, val sourceWorkId: String, val basisEpisode: Int, val episodes: List<PublishedEpisodeResponse>, val settingsWorldId: String, val settings: List<SettingPayload>)
