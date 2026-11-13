package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.world.domain.WORLD_GENRES
import ai.storyfork.content.world.domain.isListed
import ai.storyfork.content.world.domain.isPublicCard
import ai.storyfork.content.world.domain.publicWorldPage
import ai.storyfork.content.world.domain.readerCardEpisode
import ai.storyfork.content.world.domain.readerUpto
import ai.storyfork.content.world.domain.revealFromEpisode
import ai.storyfork.content.world.domain.visibleRelationships
import ai.storyfork.content.world.domain.worldGenre
import ai.storyfork.content.world.domain.worldVisibility
import ai.storyfork.content.world.service.dto.RelationshipPayload
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.data.domain.PageRequest

/** 공개 세계관과 독자 설정 위키의 순수 규칙(노출 판정·코드 검증·관계 필터·페이지 검증·독자 공개 회차). Spring·DB 없이 돈다. */
class PublicWorldRulesTest {
    private val a = UUID.randomUUID()
    private val b = UUID.randomUUID()
    private val c = UUID.randomUUID()
    private fun relation(source: UUID?, target: UUID?) = RelationshipPayload(UUID.randomUUID(), source, target, "structural", label = "관계")

    @Test fun `genre codes are exactly the seven public codes`() {
        assertEquals(listOf("fantasy", "sf", "wuxia", "romance", "modern", "classic", "mystery"), WORLD_GENRES)
    }

    @Test fun `visibility accepts only the exact private and public codes`() {
        assertEquals("public", worldVisibility("public"))
        assertEquals("private", worldVisibility("private"))
        listOf(null, "", " public", "Public", "friends").forEach {
            assertThrows(IllegalArgumentException::class.java) { worldVisibility(it) }
        }
    }

    @Test fun `genre is optional but must be an exact known code`() {
        assertNull(worldGenre(null))
        WORLD_GENRES.forEach { assertEquals(it, worldGenre(it)) }
        listOf("", " sf", "Fantasy", "romcom").forEach {
            assertThrows(IllegalArgumentException::class.java) { worldGenre(it) }
        }
    }

    @Test fun `only a public world that has a saved revision is listed`() {
        assertTrue(isListed("public", UUID.randomUUID()))
        assertFalse(isListed("public", null))
        assertFalse(isListed("private", UUID.randomUUID()))
        assertFalse(isListed("private", null))
    }

    @Test fun `a card is shown on a public world only when it is active and its owner made it public`() {
        assertTrue(isPublicCard("active", "public"))
        assertFalse(isPublicCard("active", "private"))
        assertFalse(isPublicCard("removed", "public"))
        assertFalse(isPublicCard("removed", "private"))
    }

    @Test fun `a relationship is public only when both ends are published cards`() {
        val both = relation(a, b)
        val others = listOf(relation(a, c), relation(c, UUID.randomUUID()), relation(a, null), relation(null, b), relation(null, null))
        assertEquals(listOf(both), visibleRelationships(others + both, setOf(a, b)))
        assertTrue(visibleRelationships(listOf(both), emptySet()).isEmpty())
    }

    @Test fun `the reader reveal episode is read only from a top-level whole number of at least one`() {
        assertEquals(3, revealFromEpisode(mapOf("revealFromEpisode" to 3, "studio" to mapOf("item" to "x"))))
        // jsonb 숫자는 매퍼에 따라 Int·Long·BigDecimal·Double 어느 타입으로도 올 수 있어 값으로 읽는다(JSON에는 정수·실수 구분이 없어 3.0은 3이다).
        assertEquals(1, revealFromEpisode(mapOf("revealFromEpisode" to 1L)))
        assertEquals(3, revealFromEpisode(mapOf("revealFromEpisode" to java.math.BigDecimal("3"))))
        assertEquals(3, revealFromEpisode(mapOf("revealFromEpisode" to 3.0)))
        assertEquals(Int.MAX_VALUE, revealFromEpisode(mapOf("revealFromEpisode" to Int.MAX_VALUE)))
        // 없거나 정수(1 이상)가 아니면 독자에게 숨긴다: 문자열·소수·0·음수·범위 밖·다른 타입.
        listOf(null, "3", 2.5, 0, -1, Long.MAX_VALUE, Double.NaN, true, listOf(3), mapOf("n" to 3)).forEach {
            assertNull(revealFromEpisode(mapOf("revealFromEpisode" to it)), it.toString())
        }
        assertNull(revealFromEpisode(emptyMap()))
        // 최상위 키만 읽는다. 화면이 쓰는 studio 구조 안의 값은 독자 공개가 아니다.
        assertNull(revealFromEpisode(mapOf("studio" to mapOf("revealFromEpisode" to 3))))
    }

    @Test fun `readers see an active card from its reveal episode on and nothing before it`() {
        val fromThree = mapOf<String, Any?>("revealFromEpisode" to 3)
        assertEquals(3, readerCardEpisode("active", fromThree, 3))
        assertEquals(3, readerCardEpisode("active", fromThree, 10))
        assertNull(readerCardEpisode("active", fromThree, 2))
        assertNull(readerCardEpisode("active", fromThree, 0))
        assertNull(readerCardEpisode("removed", fromThree, 10))
        assertNull(readerCardEpisode("active", emptyMap(), 10))
        assertNull(readerCardEpisode("active", mapOf("revealFromEpisode" to "3"), 10))
    }

    @Test fun `the reader upto query is optional but must be a whole number of at least one`() {
        assertNull(readerUpto(null))
        assertEquals(1, readerUpto("1"))
        assertEquals(12, readerUpto("12"))
        listOf("0", "-1", "", " 3", "x", "1.5", "2147483648").forEach {
            assertEquals(422, assertThrows(ContentFailure::class.java) { readerUpto(it) }.status, it)
        }
    }

    @Test fun `page defaults to 0 and size to 24 within 1 to 100`() {
        assertEquals(PageRequest.of(0, 24), publicWorldPage(null, null))
        assertEquals(PageRequest.of(2, 100), publicWorldPage("2", "100"))
        assertEquals(PageRequest.of(0, 1), publicWorldPage(null, "1"))
        // 가장 큰 page와 가장 큰 size의 오프셋도 int 안이어야 쿼리가 터지지 않는다.
        assertEquals(PageRequest.of(21_474_836, 100), publicWorldPage("21474836", "100"))
        assertTrue(publicWorldPage("21474836", "100").offset <= Int.MAX_VALUE)
    }

    @Test fun `bad page and size are 422 rather than a type conversion 400`() {
        listOf("-1" to null, "x" to null, "" to null, "21474837" to null, "2147483647" to "100", null to "0", null to "101", null to "x").forEach { (page, size) ->
            assertEquals(422, assertThrows(ContentFailure::class.java) { publicWorldPage(page, size) }.status)
        }
    }
}
