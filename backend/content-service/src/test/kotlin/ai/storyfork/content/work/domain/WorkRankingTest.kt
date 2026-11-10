package ai.storyfork.content.work.domain

import ai.storyfork.content._common.exception.ContentFailure
import java.time.Duration
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** 기능 45(기간별 랭킹)의 점수·제외·동점·type 필터·limit 규칙. 동점은 언제나 작품 생성 최신순([periodRankingIds]의 `newestFirst` 순서)이다. */
class WorkRankingTest {
    private val start = Instant.parse("2026-11-10T00:00:00Z")
    private fun views(vararg rows: Triple<String, Long, Long>) = rows.associate { (id, recent, prior) -> id to WorkViews(recent, prior) }
    private fun rank(kind: RankKind, newestFirst: List<String>, views: Map<String, WorkViews> = emptyMap(), likes: Map<String, Long> = emptyMap(), published: Map<String, Instant> = emptyMap()) =
        periodRankingIds(kind, newestFirst, views, likes, published)
    private fun rejected(block: () -> Unit): ContentFailure = assertThrows(ContentFailure::class.java, block)

    @Test fun `periods are rolling windows of 24 hours, 7 days and 30 days`() {
        assertEquals(listOf(Duration.ofHours(24), Duration.ofDays(7), Duration.ofDays(30)), RankPeriod.entries.map { it.length })
    }

    @Test fun `view ranking orders by period views, skips works without views and keeps newest first on ties`() {
        val ranked = rank(RankKind.VIEW, listOf("d", "c", "b", "a", "idle"), views(Triple("a", 5, 0), Triple("b", 7, 9), Triple("c", 5, 0), Triple("d", 1, 0)))
        assertEquals(listOf("b", "c", "a", "d"), ranked)
    }

    @Test fun `rising ranking orders by growth over the previous period and drops non-positive growth`() {
        val ranked = rank(RankKind.RISING, listOf("e", "d", "c", "b", "a", "idle"),
            views(Triple("a", 9, 3), Triple("b", 4, 4), Triple("c", 2, 5), Triple("d", 6, 0), Triple("e", 8, 1)))
        assertEquals(listOf("e", "d", "a"), ranked)
    }

    @Test fun `popular ranking orders by new likes then period views then newest first and skips works without new likes`() {
        val ranked = rank(RankKind.POPULAR, listOf("e", "d", "c", "b", "a", "quiet"),
            views = views(Triple("a", 5, 0), Triple("b", 9, 0), Triple("c", 9, 0), Triple("d", 100, 0), Triple("quiet", 50, 0)),
            likes = mapOf("a" to 3L, "b" to 3L, "c" to 3L, "d" to 1L))
        assertEquals(listOf("c", "b", "a", "d"), ranked)
    }

    @Test fun `latest ranking keeps the creation order and skips nothing`() {
        assertEquals(listOf("c", "b", "a"), rank(RankKind.LATEST, listOf("c", "b", "a"), views(Triple("a", 9, 0)), mapOf("a" to 5L)))
        assertEquals(emptyList<String>(), rank(RankKind.LATEST, emptyList()))
    }

    @Test fun `updated ranking orders by the last publication time, skips works never published and keeps newest first on ties`() {
        val ranked = rank(RankKind.UPDATED, listOf("d", "c", "b", "a"),
            published = mapOf("a" to start.plusSeconds(3 * 3600), "b" to start.plusSeconds(3600), "c" to start.plusSeconds(3 * 3600)))
        assertEquals(listOf("c", "a", "b"), ranked)
    }

    @Test fun `ranking is never cut so the caller can drop hidden works before taking the limit`() {
        val newestFirst = (15 downTo 1).map { "w$it" }
        val viewed = newestFirst.associateWith { WorkViews(it.drop(1).toLong(), 0) }
        for (kind in listOf(RankKind.VIEW, RankKind.RISING)) assertEquals(newestFirst, rank(kind, newestFirst, viewed), "$kind")
        assertEquals(newestFirst, rank(RankKind.POPULAR, newestFirst, likes = newestFirst.associateWith { 1L }))
        assertEquals(newestFirst, rank(RankKind.LATEST, newestFirst))
        assertEquals(newestFirst, rank(RankKind.UPDATED, newestFirst, published = newestFirst.associateWith { start }))
    }

    @Test fun `limit defaults to 10 and accepts 1 to 50`() {
        assertEquals(10, rankLimit(null))
        for (limit in listOf(1, 2, 10, 49, 50)) assertEquals(limit, rankLimit(limit.toString()))
    }

    @Test fun `limit outside 1 to 50 or not a number is 422`() {
        for (bad in listOf("0", "51", "-1", "100", "abc", "", " ", "1.5", "5 ", " 5")) assertEquals(422, rejected { rankLimit(bad) }.status, bad)
    }

    @Test fun `type filter keeps every work, only originals or only forks`() {
        assertTrue(matchesType(RankType.ALL, fork = false))
        assertTrue(matchesType(RankType.ALL, fork = true))
        assertTrue(matchesType(RankType.ORIGINAL, fork = false))
        assertFalse(matchesType(RankType.ORIGINAL, fork = true))
        assertTrue(matchesType(RankType.FORK, fork = true))
        assertFalse(matchesType(RankType.FORK, fork = false))
    }

    @Test fun `rank options read lowercase names and reject unknown values with 422`() {
        assertEquals(listOf(RankKind.VIEW, RankKind.RISING, RankKind.POPULAR, RankKind.LATEST, RankKind.UPDATED),
            listOf("view", "rising", "popular", "latest", "updated").map { queryOption(it, RankKind.VIEW, "kind") })
        assertEquals(listOf(RankPeriod.DAY, RankPeriod.WEEK, RankPeriod.MONTH), listOf("day", "week", "month").map { queryOption(it, RankPeriod.DAY, "period") })
        assertEquals(listOf(RankType.ALL, RankType.ORIGINAL, RankType.FORK), listOf("all", "original", "fork").map { queryOption(it, RankType.ALL, "type") })
        assertEquals(RankPeriod.DAY, queryOption(null, RankPeriod.DAY, "period"))
        assertEquals(RankType.ALL, queryOption(null, RankType.ALL, "type"))
        for (bad in listOf("", "top", "daily", "VIEW", " view")) assertEquals(422, rejected { queryOption(bad, RankKind.VIEW, "kind") }.status, bad)
        for (bad in listOf("", "year", "DAY", "weekly")) assertEquals(422, rejected { queryOption(bad, RankPeriod.DAY, "period") }.status, bad)
        for (bad in listOf("", "forks", "origin", "ORIGINAL")) assertEquals(422, rejected { queryOption(bad, RankType.ALL, "type") }.status, bad)
    }
}
