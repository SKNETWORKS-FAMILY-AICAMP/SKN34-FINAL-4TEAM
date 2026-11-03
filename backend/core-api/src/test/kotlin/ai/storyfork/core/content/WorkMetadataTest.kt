package ai.storyfork.core.content

import ai.storyfork.core.content.domain.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class WorkMetadataTest {
    private fun ok(genres: List<String> = listOf("판타지"), tags: List<String> = emptyList(), rights: Boolean = true,
        type: CreationType? = CreationType.ORIGINAL) = validateWorkMetadata(type, genres, tags, rights)
    private fun rejected(block: () -> Unit): ContentFailure = assertThrows(ContentFailure::class.java, block)

    @Test fun `own work with one genre and no hashtag is accepted`() {
        val m = ok()
        assertEquals(CreationType.ORIGINAL, m.type)
        assertEquals(listOf("판타지"), m.genres)
        assertTrue(m.hashtags.isEmpty())
    }
    @Test fun `creation type is required`() = assertEquals(422, rejected { ok(type = null) }.status)
    @Test fun `external derivative work is accepted`() = assertEquals(CreationType.EXTERNAL_DERIVATIVE, ok(type = CreationType.EXTERNAL_DERIVATIVE).type)

    @Test fun `genre count must be one or two`() {
        assertEquals(422, rejected { ok(genres = emptyList()) }.status)
        assertEquals(2, ok(genres = listOf("판타지", "SF")).genres.size)
        assertEquals(422, rejected { ok(genres = listOf("판타지", "SF", "무협")) }.status)
    }
    @Test fun `genre must be in the approved list and distinct`() {
        assertEquals(422, rejected { ok(genres = listOf("없는장르")) }.status)
        assertEquals(422, rejected { ok(genres = listOf("판타지", "판타지")) }.status)
        assertTrue(WORK_GENRES.containsAll(listOf("판타지", "SF", "고전", "기타")))
        assertEquals(30, WORK_GENRES.size)
    }

    @Test fun `hashtags allow zero to ten`() {
        assertEquals(10, ok(tags = (1..10).map { "태그$it" }).hashtags.size)
        assertEquals(422, rejected { ok(tags = (1..11).map { "태그$it" }) }.status)
    }
    @Test fun `hashtags are trimmed and blank ones are rejected`() {
        assertEquals(listOf("회귀"), ok(tags = listOf("  회귀 ")).hashtags)
        assertEquals(422, rejected { ok(tags = listOf("회귀", "   ")) }.status)
    }

    @Test fun `registration is blocked without rights confirmation`() = assertEquals(422, rejected { ok(rights = false) }.status)
}
