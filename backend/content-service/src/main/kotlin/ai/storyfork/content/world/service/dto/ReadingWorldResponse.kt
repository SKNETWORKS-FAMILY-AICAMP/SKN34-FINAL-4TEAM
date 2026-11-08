package ai.storyfork.content.world.service.dto

data class ReadingWorldResponse(val workId: String, val episode: Int, val documents: List<ReadingDocumentResponse>)
data class ReadingPropertyResponse(val name: String, val value: String)
data class ReadingKnowledgeResponse(val text: String, val knownAt: Int, val publicAt: Int)
data class ReadingLinkResponse(val to: String, val kind: String)
data class ReadingDocumentResponse(
    val id: String, val versionId: String, val category: String, val name: String, val body: String,
    val aliases: List<String>, val tags: List<String>, val properties: List<ReadingPropertyResponse>,
    val color: String, val image: String?, val episode: Int?, val line: String?, val participants: List<String>,
    val knowledge: List<ReadingKnowledgeResponse>, val links: List<ReadingLinkResponse>,
)
