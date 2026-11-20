package ai.storyfork.content.work

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.work.entity.GenreEntity
import ai.storyfork.content.work.repository.GenreRepository
import ai.storyfork.content.work.repository.WorkGenreRepository
import ai.storyfork.content.work.service.GenreService
import ai.storyfork.content.work.service.dto.*
import ai.storyfork.content.world.studio.repository.StudioWorldRepository
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.springframework.data.domain.Sort
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.support.TransactionTemplate

/** 장르 관리(DEC-56) 서비스를 DB 없이 검증한다. 목록·추가·수정·순서 규칙과 오류 코드는 계약 그대로다. */
class GenreServiceTest {
    private val genres = mock(GenreRepository::class.java)
    private val workGenres = mock(WorkGenreRepository::class.java)
    private val worlds = mock(StudioWorldRepository::class.java)
    private val manager = mock(PlatformTransactionManager::class.java).also {
        `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() }
    }
    private val service = GenreService(genres, workGenres, worlds, TransactionTemplate(manager))

    private fun row(n: Int, name: String = "장르$n", active: Boolean = true, featured: Boolean = false, emoji: String? = null) =
        GenreEntity("genre-%02d".format(n), "genre-%02d".format(n), name, active, n, featured, emoji)
    /** 운영 쓰기가 잠그고 읽는 전체 장르와, 쓰기 뒤 응답을 만드는 순서대로의 목록이다. */
    private fun table(vararg rows: GenreEntity): List<GenreEntity> {
        val all = rows.toList()
        `when`(genres.lockAll()).thenReturn(all)
        `when`(genres.findAll(any(Sort::class.java))).thenAnswer { all.sortedBy { it.position } }
        return all
    }
    private fun saved() = mockingDetails(genres).invocations.filter { it.method.name == "saveAndFlush" }.map { it.getArgument<GenreEntity>(0) }
    private fun failure(block: () -> Unit) = assertThrows(ContentFailure::class.java, block)
    private fun fields(g: GenreEntity) = listOf(g.code, g.name, g.active, g.position, g.featured, g.emoji)

    @Test fun `the public list is the active genres in order with only what a chip needs`() {
        `when`(genres.findActive()).thenReturn(listOf(row(1, "판타지", featured = true, emoji = "✨"), row(14, "SF")))
        assertEquals(listOf(PublicGenreResponse("genre-01", "판타지", "✨", true), PublicGenreResponse("genre-14", "SF", null, false)), service.active())
    }

    @Test fun `the operator list shows every genre with usage counts from one query each`() {
        table(row(1, "판타지", featured = true, emoji = "✨"), row(2, "숨김", active = false), row(3, "신규"))
        `when`(workGenres.workCounts()).thenReturn(listOf(arrayOf<Any>("genre-01", 5L), arrayOf<Any>("genre-02", 1L)))
        `when`(worlds.worldCounts()).thenReturn(listOf(arrayOf<Any>("genre-01", 2L)))
        assertEquals(listOf(
            GenreResponse("genre-01", "판타지", "✨", true, true, 1, 5, 2),
            GenreResponse("genre-02", "숨김", null, false, false, 2, 1, 0),
            GenreResponse("genre-03", "신규", null, true, false, 3, 0, 0),
        ), service.list())
        verify(workGenres, times(1)).workCounts()
        verify(worlds, times(1)).worldCounts()
    }

    // --- 추가 ---
    @Test fun `a new genre goes to the end as an active genre that is not on the home chips`() {
        table(row(1, "판타지"), row(30, "기타"))
        val created = service.create(GenreCreateRequest("  추리극 ", " 🔎 "))
        assertEquals(GenreResponse("genre-31", "추리극", "🔎", true, false, 31, 0, 0), created)
        assertEquals(listOf(listOf("genre-31", "추리극", true, 31, false, "🔎")), saved().map { fields(it) })
        assertEquals("genre-31", saved().single().id)
    }

    @Test fun `a duplicate name is 409 GENRE_NAME_TAKEN and nothing is saved`() {
        table(row(1, "판타지"))
        val failure = failure { service.create(GenreCreateRequest("판타지")) }
        assertEquals(409 to "GENRE_NAME_TAKEN", failure.status to failure.code)
        assertTrue(saved().isEmpty())
    }

    @Test fun `a bad name or icon is 422 before any lookup`() {
        listOf(GenreCreateRequest(null), GenreCreateRequest("  "), GenreCreateRequest("가".repeat(31)), GenreCreateRequest("추리", "😀".repeat(9))).forEach {
            assertEquals(422, failure { service.create(it) }.status)
        }
        verifyNoInteractions(genres)
    }

    // --- 수정 ---
    @Test fun `an update changes only the sent fields and an empty icon clears it`() {
        val rows = table(row(1, "판타지", emoji = "✨"), row(2, "무협"))
        assertEquals(GenreResponse("genre-01", "환상", "✨", true, false, 1, 0, 0), service.update("genre-01", GenreUpdateRequest(name = " 환상 ")))
        assertEquals(listOf("genre-01", "환상", true, 1, false, "✨"), fields(rows[0]))
        service.update("genre-01", GenreUpdateRequest(emoji = ""))
        assertNull(rows[0].emoji)
        service.update("genre-01", GenreUpdateRequest(emoji = "🌙"))
        assertEquals("🌙", rows[0].emoji)
        service.update("genre-02", GenreUpdateRequest(active = false))
        assertEquals(listOf("genre-02", "무협", false, 2, false, null), fields(rows[1]))
        assertEquals(listOf("genre-01", "환상", true, 1, false, "🌙"), fields(rows[0]))
    }

    @Test fun `renaming to another genre's name is 409 but keeping its own name is fine`() {
        val rows = table(row(1, "판타지"), row(2, "무협"))
        val failure = failure { service.update("genre-01", GenreUpdateRequest(name = "무협")) }
        assertEquals(409 to "GENRE_NAME_TAKEN", failure.status to failure.code)
        assertEquals("판타지", rows[0].name)
        service.update("genre-01", GenreUpdateRequest(name = " 판타지 "))
        assertEquals("판타지", rows[0].name)
    }

    @Test fun `an unknown code is 404 and a bad name or icon is 422 before any lookup`() {
        table(row(1))
        assertEquals(404, failure { service.update("genre-99", GenreUpdateRequest(active = false)) }.status)
        assertTrue(saved().isEmpty())
        clearInvocations(genres)
        listOf(GenreUpdateRequest(name = ""), GenreUpdateRequest(name = "가".repeat(31)), GenreUpdateRequest(emoji = "😀".repeat(9))).forEach {
            assertEquals(422, failure { service.update("genre-01", it) }.status)
        }
        verifyNoInteractions(genres)
    }

    @Test fun `the seventh genre on the home chips is 409 GENRE_FEATURED_LIMIT and the genre stays unchanged`() {
        val rows = table(*(1..6).map { row(it, featured = true) }.toTypedArray(), row(7))
        val failure = failure { service.update("genre-07", GenreUpdateRequest(featured = true)) }
        assertEquals(409 to "GENRE_FEATURED_LIMIT", failure.status to failure.code)
        assertFalse(rows[6].featured)
        assertTrue(saved().isEmpty())
    }

    @Test fun `a hidden genre does not take a home chip slot but showing it again needs one`() {
        // 숨긴 장르는 featured여도 칩에 나오지 않으므로 한도에 세지 않는다.
        val rows = table(*(1..5).map { row(it, featured = true) }.toTypedArray(), row(6, active = false, featured = true), row(7))
        service.update("genre-07", GenreUpdateRequest(featured = true))
        assertTrue(rows[6].featured)
        // 이제 칩이 6개라 숨긴 featured 장르를 다시 보이게 하면 일곱 번째 칩이 된다.
        val failure = failure { service.update("genre-06", GenreUpdateRequest(active = true)) }
        assertEquals(409 to "GENRE_FEATURED_LIMIT", failure.status to failure.code)
        assertFalse(rows[5].active)
    }

    @Test fun `at the limit a genre already on the chips can be kept, turned off or hidden`() {
        val rows = table(*(1..6).map { row(it, featured = true) }.toTypedArray())
        service.update("genre-01", GenreUpdateRequest(featured = true, name = "새 이름"))
        assertEquals("새 이름", rows[0].name)
        service.update("genre-02", GenreUpdateRequest(featured = false))
        assertFalse(rows[1].featured)
        service.update("genre-03", GenreUpdateRequest(active = false))
        assertFalse(rows[2].active)
        assertTrue(rows[2].featured)
    }

    // --- 순서 ---
    @Test fun `an order rewrites every position from 1 and answers with the new order`() {
        val rows = table(row(1, "하나"), row(2, "둘", active = false), row(3, "셋"))
        val result = service.reorder(GenreOrderRequest(listOf("genre-03", "genre-01", "genre-02")))
        // 숨긴 장르도 순서 목록에 한 번씩 들어가며 위치는 1부터 다시 매긴다.
        assertEquals(listOf(2, 3, 1), rows.map { it.position })
        assertEquals(listOf("genre-03", "genre-01", "genre-02"), result.map { it.code })
        assertEquals(listOf(1, 2, 3), result.map { it.position })
    }

    @Test fun `an order that misses duplicates or invents a code is 422 and changes nothing`() {
        val rows = table(row(1), row(2), row(3))
        val before = rows.map { it.position }
        listOf(
            GenreOrderRequest(null),
            GenreOrderRequest(emptyList()),
            GenreOrderRequest(listOf("genre-01", "genre-02")),
            GenreOrderRequest(listOf("genre-01", "genre-02", "genre-02")),
            GenreOrderRequest(listOf("genre-01", "genre-02", "genre-03", "genre-03")),
            GenreOrderRequest(listOf("genre-01", "genre-02", "genre-99")),
        ).forEachIndexed { i, request -> assertEquals(422, failure { service.reorder(request) }.status, "case $i") }
        assertEquals(before, rows.map { it.position })
    }
}
