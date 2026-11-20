package ai.storyfork.content.work.domain

import ai.storyfork.content._common.exception.ContentFailure
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class WorkMetadataTest {
    /** genre 테이블의 활성 장르 이름(V1 시드 30개)이다. 서비스가 DB에서 읽어 넘기는 '지금 고를 수 있는 장르'를 대신한다. */
    private val active = listOf(
        "판타지", "현대판타지", "무협", "선협", "퓨전", "로맨스", "로맨스판타지", "BL", "GL", "현대",
        "시대물", "역사", "대체역사", "SF", "게임", "스포츠", "드라마", "미스터리", "추리", "스릴러",
        "공포", "오컬트", "액션", "전쟁·밀리터리", "라이트노벨", "학원", "일상", "고전", "일반소설", "기타",
    ).toSet()
    private fun ok(genres: List<String> = listOf("판타지"), tags: List<String> = emptyList(), rights: Boolean = true,
        type: String? = "ORIGINAL", selectable: Set<String> = active) = validateWorkMetadata(type, genres, tags, rights, selectable)
    private fun rejected(block: () -> Unit): ContentFailure = assertThrows(ContentFailure::class.java, block)

    @Test fun `own work with one genre and no hashtag is accepted`() {
        val m = ok()
        assertEquals(CreationType.ORIGINAL, m.type)
        assertEquals(listOf("판타지"), m.genres)
        assertTrue(m.hashtags.isEmpty())
    }
    @Test fun `creation type is required and must be known`() {
        assertEquals(422, rejected { ok(type = null) }.status)
        assertEquals(422, rejected { ok(type = "FORK") }.status)
    }
    @Test fun `external derivative work is accepted`() = assertEquals(CreationType.EXTERNAL_DERIVATIVE, ok(type = "EXTERNAL_DERIVATIVE").type)

    @Test fun `genre count must be one or two`() {
        assertEquals(422, rejected { ok(genres = emptyList()) }.status)
        assertEquals(2, ok(genres = listOf("판타지", "SF")).genres.size)
        assertEquals(422, rejected { ok(genres = listOf("판타지", "SF", "무협")) }.status)
    }
    @Test fun `genre must be selectable and distinct`() {
        assertEquals(422, rejected { ok(genres = listOf("없는장르")) }.status)
        assertEquals(422, rejected { ok(genres = listOf("판타지", "판타지")) }.status)
        // 숨긴 장르는 선택지(활성 장르 + 이 작품에 이미 붙은 장르)에 없으면 새로 붙일 수 없고, 선택지에 있으면 통과한다(DEC-56).
        assertEquals(422, rejected { ok(genres = listOf("SF"), selectable = active - "SF") }.status)
        assertEquals(listOf("SF"), ok(genres = listOf("SF"), selectable = setOf("SF")).genres)
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
