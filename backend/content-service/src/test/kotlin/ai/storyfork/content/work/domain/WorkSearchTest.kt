package ai.storyfork.content.work.domain

import ai.storyfork.content._common.exception.ContentFailure
import java.time.Instant
import java.time.LocalDate
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class WorkSearchTest {
    private fun matches(query: String?, field: SearchField = SearchField.ALL) =
        matchesSearch("달빛 정원 Garden", "윤서하 Writer", listOf("판타지", "로맨스판타지"), listOf("회귀", "#먼치킨", "Dark"), query, field)
    private fun counts(vararg rows: Triple<String, Long, Long>) = rows.associate { (id, recent, prior) -> id to WorkViews(recent, prior) }
    private fun rejected(block: () -> Unit): ContentFailure = assertThrows(ContentFailure::class.java, block)

    @Test fun `missing or blank query matches every work in every field`() {
        for (field in SearchField.entries) {
            assertTrue(matches(null, field), "$field")
            assertTrue(matches("   ", field), "$field")
        }
    }

    @Test fun `title search is a case-insensitive partial match on the trimmed query`() {
        assertTrue(matches("  garden ", SearchField.TITLE))
        assertTrue(matches("빛 정", SearchField.TITLE))
        assertFalse(matches("회귀", SearchField.TITLE))
        assertFalse(matches("판타지", SearchField.TITLE))
        assertFalse(matches("윤서", SearchField.TITLE))
    }

    @Test fun `author search is a case-insensitive partial match on the author name only`() {
        assertTrue(matches("윤서", SearchField.AUTHOR))
        assertTrue(matches("  writer ", SearchField.AUTHOR))
        assertTrue(matches("하 wri", SearchField.AUTHOR))
        for (query in listOf("정원", "회귀", "판타지")) assertFalse(matches(query, SearchField.AUTHOR), query)
        for (field in listOf(SearchField.TAG, SearchField.GENRE)) assertFalse(matches("윤서", field), "$field")
    }

    @Test fun `tag search ignores a leading hash on the query and on the stored tag`() {
        for (query in listOf("#회귀", "회귀", "먼치킨", "#먼치", "dark")) assertTrue(matches(query, SearchField.TAG), query)
        assertFalse(matches("정원", SearchField.TAG))
        assertFalse(matches("판타지", SearchField.TAG))
    }

    @Test fun `genre search is a partial match on genre names only`() {
        assertTrue(matches("판타지", SearchField.GENRE))
        assertTrue(matches("로맨스", SearchField.GENRE))
        assertFalse(matches("정원", SearchField.GENRE))
        assertFalse(matches("회귀", SearchField.GENRE))
    }

    @Test fun `all searches title author tag and genre together`() {
        for (query in listOf("정원", "윤서", "writer", "회귀", "#회귀", "로맨스")) assertTrue(matches(query, SearchField.ALL), query)
        assertFalse(matches("없는검색어", SearchField.ALL))
    }

    @Test fun `query options default when absent and reject unknown values with 422`() {
        assertEquals(SearchField.ALL, queryOption(null, SearchField.ALL, "f"))
        assertEquals(SearchField.GENRE, queryOption("genre", SearchField.ALL, "f"))
        assertEquals(SearchField.AUTHOR, queryOption("author", SearchField.ALL, "f"))
        assertEquals(WorkSort.VIEW, queryOption("view", WorkSort.LATEST, "sort"))
        assertEquals(WorkSort.LIKE, queryOption("like", WorkSort.LATEST, "sort"))
        assertEquals(RankingKind.RISING, queryOption("rising", RankingKind.TOP, "kind"))
        for (bad in listOf("", " ", "body", "AUTHOR", "TAG", " tag")) assertEquals(422, rejected { queryOption(bad, SearchField.ALL, "f") }.status, bad)
        assertEquals(422, rejected { queryOption("popular", WorkSort.LATEST, "sort") }.status)
        assertEquals(422, rejected { queryOption("daily", RankingKind.TOP, "kind") }.status)
    }

    @Test fun `top ranking orders by the last 24 hours, skips works without views and keeps newest first on ties`() {
        val newestFirst = listOf("d", "c", "b", "a", "idle")
        val ranked = rankingIds(RankingKind.TOP, newestFirst, counts(Triple("a", 5, 0), Triple("b", 7, 9), Triple("c", 5, 0), Triple("d", 1, 0)))
        assertEquals(listOf("b", "c", "a", "d"), ranked)
    }

    @Test fun `top ranking returns at most ten works`() {
        val newestFirst = (12 downTo 1).map { "w$it" }
        val ranked = rankingIds(RankingKind.TOP, newestFirst, newestFirst.associateWith { WorkViews(it.drop(1).toLong(), 0) })
        assertEquals((12 downTo 3).map { "w$it" }, ranked)
    }

    @Test fun `rising ranking orders by growth over the previous 24 hours and drops non-positive growth`() {
        val newestFirst = listOf("e", "d", "c", "b", "a", "idle")
        val ranked = rankingIds(RankingKind.RISING, newestFirst,
            counts(Triple("a", 5, 5), Triple("b", 7, 9), Triple("c", 5, 0), Triple("d", 3, 0), Triple("e", 4, 1)))
        assertEquals(listOf("c", "e", "d"), ranked)
    }

    @Test fun `rising ranking can include works that top ranking ranks lower`() {
        val newestFirst = listOf("steady", "surge")
        val data = counts(Triple("steady", 10, 10), Triple("surge", 4, 0))
        assertEquals(listOf("steady", "surge"), rankingIds(RankingKind.TOP, newestFirst, data))
        assertEquals(listOf("surge"), rankingIds(RankingKind.RISING, newestFirst, data))
    }

    @Test fun `view order keeps works without views and breaks ties by newest first`() {
        val newestFirst = listOf("new", "mid", "old", "idle")
        assertEquals(listOf("old", "new", "mid", "idle"), orderByViews(newestFirst, counts(Triple("old", 4, 0), Triple("new", 1, 9), Triple("mid", 1, 0))))
        assertEquals(newestFirst, orderByViews(newestFirst, emptyMap()))
    }

    @Test fun `like order puts the most liked first, keeps works without likes and breaks ties by newest first`() {
        val newestFirst = listOf("new", "mid", "old", "idle")
        assertEquals(listOf("old", "new", "mid", "idle"), orderByLikes(newestFirst, mapOf("old" to 4L, "new" to 1L, "mid" to 1L)))
        assertEquals(newestFirst, orderByLikes(newestFirst, emptyMap()))
    }

    @Test fun `page and size are optional, both absent means the whole list and a missing one takes its default`() {
        assertNull(workPage(null, null))
        assertEquals(WorkPage(0, 20), workPage("0", null))
        assertEquals(WorkPage(0, 5), workPage(null, "5"))
        assertEquals(WorkPage(3, 100), workPage("3", "100"))
        assertEquals(WorkPage(0, 1), workPage("0", "1"))
    }

    @Test fun `a negative page, a size outside 1 to 100 and a non numeric value are 422 in the same format as the other options`() {
        for (bad in listOf("-1", "abc", "", " 1", "1.5", "99999999999")) assertEquals(422, rejected { workPage(bad, null) }.status, "page=$bad")
        for (bad in listOf("0", "-1", "101", "abc", "", "1.5")) assertEquals(422, rejected { workPage(null, bad) }.status, "size=$bad")
        assertEquals(422, rejected { workPage("0", "0") }.status)
        assertEquals(422, rejected { workPage("abc", "10") }.status)
        assertEquals("page 값을 확인해 주세요.", rejected { workPage("-1", null) }.message)
        assertEquals("size 값을 확인해 주세요.", rejected { workPage(null, "101") }.message)
    }

    @Test fun `a page is the slice of the sorted list and a page beyond the end is empty`() {
        val sorted = (1..5).map { "w$it" }
        assertEquals(sorted, pageOf(sorted, null))
        assertEquals(listOf("w1", "w2"), pageOf(sorted, WorkPage(0, 2)))
        assertEquals(listOf("w3", "w4"), pageOf(sorted, WorkPage(1, 2)))
        assertEquals(listOf("w5"), pageOf(sorted, WorkPage(2, 2)))
        assertEquals(emptyList<String>(), pageOf(sorted, WorkPage(3, 2)))
        assertEquals(sorted, pageOf(sorted, WorkPage(0, 100)))
        // 아주 큰 page도 오버플로 없이 빈 목록이다.
        assertEquals(emptyList<String>(), pageOf(sorted, WorkPage(Int.MAX_VALUE, 100)))
        assertEquals(emptyList<String>(), pageOf(emptyList<String>(), WorkPage(0, 20)))
    }

    @Test fun `view date is the Asia Seoul calendar day`() {
        assertEquals(LocalDate.of(2026, 11, 8), viewDate(Instant.parse("2026-11-08T14:59:59Z")))
        assertEquals(LocalDate.of(2026, 11, 9), viewDate(Instant.parse("2026-11-08T15:00:00Z")))
        assertEquals(LocalDate.of(2026, 11, 9), viewDate(Instant.parse("2026-11-09T14:59:59Z")))
    }
}
