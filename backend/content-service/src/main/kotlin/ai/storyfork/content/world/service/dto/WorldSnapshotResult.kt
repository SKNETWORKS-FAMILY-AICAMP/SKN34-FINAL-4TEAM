package ai.storyfork.content.world.service.dto


data class WorldSnapshotResult(val worldId: String, val workWorldHistoryId: String, val settings: List<SettingPayload>)
