package ai.storyfork.core.context.service.dto


data class ContextEpisodeResponse(val number: Int, val version: Int, val versionId: String, val title: String, val sourceCharacters: Int, val excerpts: List<ExcerptResponse>)
