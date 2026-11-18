package ai.storyfork.content.world

import ai.storyfork.content.world.domain.matchesCard
import ai.storyfork.content.world.domain.matchesWorld
import ai.storyfork.content.world.domain.searchTerm
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** 세계관·설정 카드 검색의 순수 규칙(#505): 검색어는 앞뒤 공백을 자르고, 이름·설명·작가나 제목·별칭·태그의 대소문자 무시 부분 일치로 찾는다. */
class WorldSearchTest {
    @Test fun `a missing or blank query is no query and any other query is trimmed`() {
        listOf(null, "", "   ", "\t\n").forEach { assertNull(searchTerm(it), "[$it]") }
        assertEquals("달빛 세계", searchTerm("  달빛 세계\n"))
    }

    @Test fun `a world matches by saved name, description or author nickname, ignoring case`() {
        assertTrue(matchesWorld("Moonlight 세계", "설명", "작가", "MOON"))
        assertTrue(matchesWorld("이름", "용이 사는 Dragon 땅", "작가", "dragon"))
        assertTrue(matchesWorld("이름", "설명", "필명 Hana", "hANA"))
        assertFalse(matchesWorld("이름", "설명", "작가", "없는말"))
    }

    @Test fun `a card matches by title, alias or tag, ignoring case`() {
        assertTrue(matchesCard("Aria 공주", listOf("별칭"), listOf("태그"), "aria"))
        assertTrue(matchesCard("공주", listOf("별칭", "은빛 Wolf"), listOf("태그"), "WOLF"))
        assertTrue(matchesCard("공주", listOf("별칭"), listOf("왕족", "Royal"), "royal"))
        assertFalse(matchesCard("공주", listOf("별칭"), listOf("태그"), "본문"))
    }
}
