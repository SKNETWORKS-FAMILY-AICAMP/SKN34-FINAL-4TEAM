package ai.storyfork.content.episode_version.service.dto


data class VersionResponse(val id: String, val title: String, val body: String, val revision: Int, val episode: Int, val savedAt: String, val authorNote: String = "")
