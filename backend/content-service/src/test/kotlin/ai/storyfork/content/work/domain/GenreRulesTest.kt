package ai.storyfork.content.work.domain

import ai.storyfork.content._common.exception.ContentFailure
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** 장르 관리(DEC-56)의 순수 규칙이다. 이름·아이콘 검사와 새 코드 번호는 DB 없이 돈다. */
class GenreRulesTest {
    private fun rejected(block: () -> Unit): ContentFailure = assertThrows(ContentFailure::class.java, block)

    @Test fun `a name is trimmed and must be 1 to 30 characters counted by code point`() {
        assertEquals("추리", genreName("  추리 "))
        assertEquals("가".repeat(30), genreName("가".repeat(30)))
        // 이모지 한 개를 둘로 세지 않는다.
        assertEquals("😀".repeat(30), genreName("😀".repeat(30)))
        listOf(null, "", "   ", "가".repeat(31)).forEach { assertEquals(422, rejected { genreName(it) }.status, it.toString()) }
    }

    @Test fun `an icon is optional, trimmed, blank means none and it holds at most 8 characters`() {
        assertNull(genreEmoji(null))
        assertNull(genreEmoji(""))
        assertNull(genreEmoji("   "))
        assertEquals("✨", genreEmoji(" ✨ "))
        assertEquals("😀".repeat(8), genreEmoji("😀".repeat(8)))
        assertEquals(422, rejected { genreEmoji("😀".repeat(9)) }.status)
    }

    @Test fun `the next code follows the largest genre number and keeps two digits`() {
        assertEquals("genre-01", nextGenreCode(emptyList()))
        assertEquals("genre-31", nextGenreCode((1..30).map { "genre-%02d".format(it) }))
        assertEquals("genre-100", nextGenreCode(listOf("genre-99")))
        // 번호가 아닌 코드는 무시하고 가장 큰 번호의 다음이며 중간의 빈 번호는 채우지 않는다.
        assertEquals("genre-08", nextGenreCode(listOf("genre-01", "genre-07", "legacy")))
    }
}
