package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.work.domain.genreName
import ai.storyfork.content.work.domain.nextGenreCode
import ai.storyfork.content.work.domain.nextNumberedCode
import ai.storyfork.content.world.domain.DEFAULT_CARD_TYPES
import ai.storyfork.content.world.domain.aiCardType
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** 카드 카테고리의 순수 규칙이다. AI가 아는 카드 유형은 기본 8종뿐이라 그 밖의 코드는 보낼 때 other로 바꾼다. */
class CardCategoryRulesTest {
    @Test fun `the default types are the eight codes the AI knows`() {
        assertEquals(listOf("character", "location", "organization", "ability", "object", "rule", "event", "other"), DEFAULT_CARD_TYPES)
    }

    @Test fun `the AI gets a default type as it is and any other code as other`() {
        for (type in DEFAULT_CARD_TYPES) assertEquals(type, aiCardType(type))
        for (type in listOf("category-01", "category-12", "", "Character", "claim")) assertEquals("other", aiCardType(type), type)
    }

    @Test fun `a numbered code follows the largest number of its own prefix and genre codes work as before`() {
        assertEquals("category-01", nextNumberedCode("category", emptyList()))
        assertEquals("category-04", nextNumberedCode("category", listOf("category-03", "character", "genre-09")))
        assertEquals("category-100", nextNumberedCode("category", listOf("category-99")))
        assertEquals("genre-31", nextGenreCode((1..30).map { "genre-%02d".format(it) }))
        assertEquals("genre-08", nextGenreCode(listOf("genre-01", "genre-07", "category-40")))
    }

    @Test fun `the shared name rule takes the label for its message`() {
        val failure = assertThrows(ContentFailure::class.java) { genreName("가".repeat(31), "카테고리") }
        assertEquals(422, failure.status)
        assertTrue(failure.message.startsWith("카테고리 이름은"), failure.message)
        assertTrue(assertThrows(ContentFailure::class.java) { genreName(" ") }.message.startsWith("장르 이름은"))
    }
}
