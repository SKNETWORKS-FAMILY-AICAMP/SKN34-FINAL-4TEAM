package ai.storyfork.content.publication.service.dto


data class PublicationResponse(val episode: Int, val versionId: String, val publishedAt: String, val action: String = "publish")
