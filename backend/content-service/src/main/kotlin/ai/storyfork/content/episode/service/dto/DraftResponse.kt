package ai.storyfork.content.episode.service.dto


data class DraftResponse(val title: String = "새 회차", val body: String = "", val revision: Int = 0, val authorNote: String = "")
