package ai.storyfork.content.world.service.dto

data class WorldCheckpointSummary(val id: String, val createdAt: String)
data class WorldCheckpointResponse(val id: String, val createdAt: String, val settings: List<SettingPayload>)
