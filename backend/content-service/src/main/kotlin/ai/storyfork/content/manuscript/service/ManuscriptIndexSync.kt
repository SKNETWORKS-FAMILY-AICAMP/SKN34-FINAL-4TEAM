package ai.storyfork.content.manuscript.service

import ai.storyfork.content._common.helper.contentKey
import ai.storyfork.content.manuscript.client.ManuscriptElasticsearch
import ai.storyfork.content.manuscript.client.ManuscriptEmbeddingClient
import java.security.MessageDigest
import java.text.Normalizer
import java.util.HexFormat

private val paragraphBreak = Regex("\\r?\\n[ \\t]*\\r?\\n(?:[ \\t]*\\r?\\n)*")
private const val chunkSize = 256
private const val normalizedByteLimit = 480

internal fun manuscriptHash(body: String): String =
    HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body.toByteArray(Charsets.UTF_8)))

internal data class PublishedManuscript(
    val workId: String,
    val sourceWorkId: String?,
    val episodeId: String,
    val number: Int,
    val revision: String,
    val body: String,
) {
    fun chunks(): List<ManuscriptChunk> {
        val hash = manuscriptHash(body)
        return buildList {
            fun appendParagraph(from: Int, to: Int) {
                var start = from
                var end = to
                while (start < end && body[start].isWhitespace()) start++
                while (start < end && body[end - 1].isWhitespace()) end--
                while (start < end) {
                    fun boundary(index: Int) = if (index < end && Character.isSurrogatePair(body[index - 1], body[index])) index - 1 else index
                    var cut = boundary(minOf(start + chunkSize, end))
                    // 호환 문자 정규화로 토큰 입력이 크게 늘어나는 문단도 잘라 원문 위치를 보존한다.
                    while (Normalizer.normalize(body.substring(start, cut), Normalizer.Form.NFKC).toByteArray().size > normalizedByteLimit) {
                        cut = boundary(start + (cut - start) / 2)
                    }
                    if (body.substring(start, cut).isNotBlank()) add(ManuscriptChunk(this@PublishedManuscript, hash, start, cut))
                    start = cut
                }
            }

            var start = 0
            for (separator in paragraphBreak.findAll(body)) {
                appendParagraph(start, separator.range.first)
                start = separator.range.last + 1
            }
            appendParagraph(start, body.length)
        }
    }
}

internal data class ManuscriptChunk(val source: PublishedManuscript, val sourceHash: String, val start: Int, val end: Int) {
    val id = contentKey("manuscript-v1", source.workId, source.episodeId, source.revision, sourceHash, start.toString(), end.toString())
    val text get() = source.body.substring(start, end)

    fun document(vector: List<Float>): Map<String, Any> = buildMap {
        put("work_id", source.workId)
        source.sourceWorkId?.let { put("source_work_id", it) }
        put("episode_id", source.episodeId)
        put("episode_number", source.number)
        put("source_revision", source.revision)
        put("source_hash", sourceHash)
        put("start_utf16", start)
        put("end_utf16", end)
        put("index_generation", 1)
        put("embedding", vector)
    }
}

internal data class ManuscriptIndexChanges(val added: Int, val removed: Int)

internal class ManuscriptIndexSync(
    private val index: ManuscriptElasticsearch,
    private val embedder: ManuscriptEmbeddingClient,
) {
    fun reconcile(manuscripts: List<PublishedManuscript>): ManuscriptIndexChanges {
        val wanted = manuscripts.flatMap { it.chunks() }.associateBy { it.id }
        val existing = index.ids()
        val stale = existing - wanted.keys
        stale.chunked(100).forEach(index::remove)
        val missing = wanted.values.filterNot { it.id in existing }
        for (batch in missing.chunked(16)) {
            val vectors = embedder.passages(batch.map { it.text })
            index.put(batch, vectors)
        }
        return ManuscriptIndexChanges(missing.size, stale.size)
    }
}
