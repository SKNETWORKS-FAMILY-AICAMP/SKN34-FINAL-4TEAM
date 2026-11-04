package ai.storyfork.content.publication.service.dto


data class PublishedEpisodeResponse(val number: Int, val version: Int, val versionId: String, val title: String, val body: String, val inherited: Boolean = false)
