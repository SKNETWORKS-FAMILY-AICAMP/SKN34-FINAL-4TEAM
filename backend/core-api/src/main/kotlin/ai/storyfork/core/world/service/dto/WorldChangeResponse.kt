package ai.storyfork.core.world.service.dto


data class WorldChangeResponse(val id: String, val settingId: String, val before: SettingPayload?, val after: SettingPayload?, val decision: String)
