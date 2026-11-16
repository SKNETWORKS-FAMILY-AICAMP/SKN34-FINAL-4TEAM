package ai.storyfork.content.manuscript

import ai.storyfork.content.manuscript.client.ManuscriptElasticsearch
import ai.storyfork.content.manuscript.client.ManuscriptEmbeddingClient
import ai.storyfork.content.manuscript.service.ManuscriptIndexSync
import ai.storyfork.content.manuscript.service.PublishedManuscript
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

class ManuscriptIndexSyncTest {
    private val index = mock(ManuscriptElasticsearch::class.java)
    private val embedder = mock(ManuscriptEmbeddingClient::class.java)
    private val sync = ManuscriptIndexSync(index, embedder)
    private val original = PublishedManuscript("work", null, "episode", 2, "v1", "첫 문단 🐉\r\n\r\n다음 문단")
    private val fork = original.copy(workId = "fork", sourceWorkId = "work", episodeId = "inherited")
    private val vector = List(384) { 0.05f }

    @Test
    fun `원문 위치를 보존하고 같은 판본을 상속한 Fork도 별도 청크를 갖는다`() {
        val originalChunks = original.chunks()
        val forkChunks = fork.chunks()
        assertEquals(listOf("첫 문단 🐉", "다음 문단"), originalChunks.map { it.text })
        assertEquals(listOf(0 to 7, 11 to 16), originalChunks.map { it.start to it.end })
        assertEquals(originalChunks.map { it.sourceHash }, forkChunks.map { it.sourceHash })
        assertTrue(originalChunks.map { it.id }.intersect(forkChunks.map { it.id }.toSet()).isEmpty())
        val longBody = "a".repeat(255) + "🐉" + "b".repeat(300)
        val chunks = original.copy(body = longBody).chunks()
        assertEquals(longBody, chunks.joinToString("") { it.text })
        assertEquals(255, chunks.first().end)
        assertTrue(chunks.all { longBody.substring(it.start, it.end) == it.text })
        val expandedBody = "ﷺ".repeat(200)
        val expandedChunks = original.copy(body = expandedBody).chunks()
        assertTrue(expandedChunks.size > 1)
        assertEquals(expandedBody, expandedChunks.joinToString("") { it.text })
    }

    @Test
    fun `새 발행본만 임베딩하고 구판과 삭제 회차는 제거한다`() {
        val replacement = original.copy(revision = "v2", body = "최신 발행본")
        val removed = original.copy(episodeId = "removed").chunks().map { it.id }
        val stale = original.chunks().map { it.id } + removed
        val inherited = fork.chunks().map { it.id }
        `when`(index.ids()).thenReturn((stale + inherited).toSet())
        `when`(embedder.passages(listOf(replacement.body))).thenReturn(listOf(vector))

        val result = sync.reconcile(listOf(replacement, fork))

        assertEquals(1, result.added)
        assertEquals(stale.size, result.removed)
        val ordered = inOrder(index, embedder)
        ordered.verify(index).ids()
        ordered.verify(index).remove(stale)
        ordered.verify(embedder).passages(listOf(replacement.body))
        ordered.verify(index).put(replacement.chunks(), listOf(vector))
    }

    @Test
    fun `임베딩 실패 후 다음 실행에서 누락된 청크만 재처리한다`() {
        val chunks = original.chunks()
        val texts = chunks.map { it.text }
        `when`(index.ids()).thenReturn(emptySet(), setOf(chunks.first().id), chunks.map { it.id }.toSet())
        `when`(embedder.passages(texts)).thenThrow(IllegalStateException())
        `when`(embedder.passages(listOf(chunks.last().text))).thenReturn(listOf(vector))

        assertThrows(IllegalStateException::class.java) { sync.reconcile(listOf(original)) }
        assertEquals(1, sync.reconcile(listOf(original)).added)
        assertEquals(0, sync.reconcile(listOf(original)).added)
        verify(index).put(listOf(chunks.last()), listOf(vector))
        verify(index, never()).put(chunks, listOf(vector, vector))
    }
}
