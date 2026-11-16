package ai.storyfork.content.manuscript.client

import ai.storyfork.content.manuscript.client.dto.ManuscriptEmbeddingPayload
import ai.storyfork.content.manuscript.client.dto.ManuscriptEmbeddingResponse
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient

internal const val manuscriptModel = "intfloat/multilingual-e5-small"
internal const val manuscriptModelRevision = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
internal const val manuscriptModelArtifact = "onnx/model_qint8_avx512_vnni.onnx"
internal const val manuscriptDimensions = 384

internal class ManuscriptEmbeddingClient(private val http: RestClient, private val token: String) {
    fun passages(texts: List<String>) = embed(texts, "passage")
    fun query(text: String) = embed(listOf(text), "query").single()

    private fun embed(texts: List<String>, kind: String): List<List<Float>> {
        val response = checkNotNull(http.post().uri("/internal/v1/manuscript/embeddings")
            .contentType(MediaType.APPLICATION_JSON).header("X-Internal-Token", token)
            .body(ManuscriptEmbeddingPayload(texts, kind)).retrieve().body(ManuscriptEmbeddingResponse::class.java))
        check(response.model == manuscriptModel && response.revision == manuscriptModelRevision) { "Unexpected manuscript embedding model" }
        check(response.vectors.size == texts.size && response.vectors.all { vector ->
            vector.size == manuscriptDimensions && vector.all(Float::isFinite) && vector.any { it != 0f }
        }) { "Invalid manuscript embeddings" }
        return response.vectors
    }
}
