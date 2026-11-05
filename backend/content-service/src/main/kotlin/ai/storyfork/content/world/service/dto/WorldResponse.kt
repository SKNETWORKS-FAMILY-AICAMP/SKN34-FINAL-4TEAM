package ai.storyfork.content.world.service.dto


data class WorldResponse(val id: String, val name: String, val revision: Int, val mode: String, val basis: BasisResponse?, val draft: SettingPayload?, val drafts: List<SettingPayload>, val settings: List<SettingPayload>, val history: List<SettingPayload>, val sourceToken: String, val changes: List<WorldChangeResponse>)
