package ai.storyfork.content.world.service.dto

data class SourceSnapshotsResult(val sourceWorldId: String, val before: List<SettingPayload>, val after: List<SettingPayload>)
