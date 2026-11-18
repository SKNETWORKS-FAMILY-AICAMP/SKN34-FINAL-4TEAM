package ai.storyfork.content.search

import ai.storyfork.content.search.client.SearchElasticsearch
import ai.storyfork.content.search.domain.workDocument
import ai.storyfork.content.search.service.SearchIndexChanges
import ai.storyfork.content.search.service.SearchIndexSync
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

/** 주기 대조(추가·갱신·삭제)의 차이 계산이다. 색인 클라이언트는 대역이다. */
class SearchIndexSyncTest {
    private val index = mock(SearchElasticsearch::class.java)
    private val sync = SearchIndexSync(index)
    private fun work(id: String, title: String = "작품 $id") = workDocument(id, title, "작가", emptyList(), emptyList())

    @Test fun `only added and changed documents are written and documents no longer wanted are removed`() {
        val keep = work("keep")
        val changed = work("changed", "새 제목")
        val added = work("added")
        `when`(index.hashes()).thenReturn(mapOf(keep.key to keep.hash, changed.key to "옛 해시", "world:gone" to "x"))

        assertEquals(SearchIndexChanges(put = 2, removed = 1), sync.reconcile(listOf(keep, changed, added)))

        val ordered = inOrder(index)
        ordered.verify(index).hashes()
        ordered.verify(index).remove(listOf("world:gone"))
        ordered.verify(index).put(listOf(changed, added))
        verifyNoMoreInteractions(index)
    }

    @Test fun `an index that is already up to date is left alone`() {
        val a = work("a")
        `when`(index.hashes()).thenReturn(mapOf(a.key to a.hash))
        assertEquals(SearchIndexChanges(put = 0, removed = 0), sync.reconcile(listOf(a)))
        verify(index).hashes()
        verifyNoMoreInteractions(index)
    }

    @Test fun `writes and removals go in batches of 100`() {
        val docs = (1..250).map { work("w$it") }
        val stale = (1..150).map { "work:old$it" }
        `when`(index.hashes()).thenReturn(stale.associateWith { "x" })

        sync.reconcile(docs)

        verify(index).put(docs.take(100))
        verify(index).put(docs.drop(100).take(100))
        verify(index).put(docs.drop(200))
        verify(index).remove(stale.take(100))
        verify(index).remove(stale.drop(100))
    }

    @Test fun `a failure while writing stops the run so the next cycle retries the difference`() {
        val a = work("a")
        `when`(index.hashes()).thenReturn(emptyMap())
        doThrow(IllegalStateException("bulk failed")).`when`(index).put(listOf(a))
        assertThrows(IllegalStateException::class.java) { sync.reconcile(listOf(a)) }
    }
}
