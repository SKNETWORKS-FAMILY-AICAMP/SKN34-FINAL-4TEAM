package ai.storyfork.content.search

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.search.client.SearchElasticsearch
import ai.storyfork.content.search.domain.SearchHit
import ai.storyfork.content.search.domain.SearchKind
import ai.storyfork.content.search.service.SEARCH_CANDIDATE_LIMIT
import ai.storyfork.content.search.service.SearchCandidates
import ai.storyfork.content.work.domain.SearchField
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.web.client.ResourceAccessException

/** 검색 경로 선택은 이 한 곳이다: 색인이 없으면 null(호출자가 DB 전체를 읽음), 있으면 색인의 후보 ID, 색인 실패는 503이다. 색인 클라이언트는 대역이다. */
class SearchCandidatesTest {
    private val index = mock(SearchElasticsearch::class.java)
    private val on = SearchCandidates(index)
    private val worldA = UUID.randomUUID()
    private val worldB = UUID.randomUUID()
    private fun hits(vararg ids: String) = ids.map { SearchHit(it, null) }

    @Test fun `without an index there are no candidates, so every search reads the database`() {
        val off = SearchCandidates(null)
        assertNull(off.works("달빛", SearchField.ALL))
        assertNull(off.worlds("달빛"))
        assertNull(off.cardWorlds("달빛"))
    }

    @Test fun `a missing or blank work query asks the index nothing`() {
        listOf(null, "", "  ", "\t\n").forEach { assertNull(on.works(it, SearchField.ALL)) }
        verifyNoInteractions(index)
    }

    @Test fun `work candidates search the fields the option names, and a tag ignores the leading hash`() {
        `when`(index.candidates(SearchKind.WORK, mapOf("tags" to "마법"), SEARCH_CANDIDATE_LIMIT)).thenReturn(hits("w1", "w2"))
        `when`(index.candidates(SearchKind.WORK, mapOf("title" to "달"), SEARCH_CANDIDATE_LIMIT)).thenReturn(hits("w3"))
        `when`(index.candidates(SearchKind.WORK, mapOf("author" to "달"), SEARCH_CANDIDATE_LIMIT)).thenReturn(hits("w4"))
        `when`(index.candidates(SearchKind.WORK, mapOf("genres" to "달"), SEARCH_CANDIDATE_LIMIT)).thenReturn(hits("w5"))

        assertEquals(setOf("w1", "w2"), on.works(" #마법 ", SearchField.TAG))
        assertEquals(setOf("w3"), on.works("달", SearchField.TITLE))
        assertEquals(setOf("w4"), on.works("달", SearchField.AUTHOR))
        assertEquals(setOf("w5"), on.works("달", SearchField.GENRE))
    }

    @Test fun `all fields search title, author and genre with the query and tags without the hash, like the database match`() {
        `when`(index.candidates(SearchKind.WORK, mapOf("title" to "#달", "author" to "#달", "tags" to "달", "genres" to "#달"), SEARCH_CANDIDATE_LIMIT))
            .thenReturn(hits("w1"))
        assertEquals(setOf("w1"), on.works("#달", SearchField.ALL))
    }

    @Test fun `world candidates are world ids and card candidates are the worlds of the matching cards`() {
        `when`(index.candidates(SearchKind.WORLD, mapOf("name" to "달", "description" to "달", "author" to "달"), SEARCH_CANDIDATE_LIMIT))
            .thenReturn(hits(worldA.toString()))
        `when`(index.candidates(SearchKind.CARD, mapOf("title" to "달", "aliases" to "달", "tags" to "달"), SEARCH_CANDIDATE_LIMIT))
            .thenReturn(listOf(SearchHit("c1", worldA.toString()), SearchHit("c2", worldA.toString()), SearchHit("c3", worldB.toString())))

        assertEquals(setOf(worldA), on.worlds("달"))
        assertEquals(setOf(worldA, worldB), on.cardWorlds("달"))
    }

    @Test fun `an index failure is a 503 and never an empty or database result`() {
        listOf<Throwable>(ResourceAccessException("down"), IllegalStateException("incomplete")).forEach { failure ->
            doThrow(failure).`when`(index).candidates(SearchKind.WORLD, mapOf("name" to "달", "description" to "달", "author" to "달"), SEARCH_CANDIDATE_LIMIT)
            assertEquals(503, assertThrows(ContentFailure::class.java) { on.worlds("달") }.status, failure.toString())
        }
    }
}
