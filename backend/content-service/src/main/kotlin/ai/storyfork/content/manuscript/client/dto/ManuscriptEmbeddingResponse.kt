package ai.storyfork.content.manuscript.client.dto

internal data class ManuscriptEmbeddingResponse(val model: String, val revision: String, val vectors: List<List<Float>>)
