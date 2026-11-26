package ai.storyfork.core.notification

import ai.storyfork.core.notification.domain.NoticeDetail
import ai.storyfork.core.notification.domain.NoticeEventType
import ai.storyfork.core.notification.domain.NoticeEventType.*
import ai.storyfork.core.notification.domain.NoticeSummary
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** 사건 상세(detail)로 만든 알림 문구(#941). 문구 예시는 이슈 #941의 표를 따른다. */
class NoticeSummaryTest {
    private fun summary(type: NoticeEventType, title: String? = "별의 숲", ep: Int? = null, subject: String? = null, reason: String? = null) =
        NoticeSummary.of(type, NoticeDetail(title, ep, subject, reason)).summary

    @Test
    fun `without detail or title every type keeps its fixed summary`() {
        NoticeEventType.entries.forEach { type ->
            assertEquals(type.summary, NoticeSummary.of(type, null).summary, type.code)
            assertEquals(type.summary, summary(type, title = null, ep = 3, subject = "원고"), type.code)
            assertEquals(type.summary, summary(type, title = "  \n "), type.code)
        }
    }

    @Test
    fun `ai changes name the work, episode and what changed with the right object particle`() {
        assertEquals("AI가 MCP로 「별의 숲」 3화 원고를 수정했어요", summary(MCP_WORK_CHANGED, ep = 3, subject = "원고"))
        assertEquals("AI가 MCP로 「별의 숲」 플롯을 수정했어요", summary(MCP_WORK_CHANGED, subject = "플롯"))
        assertEquals("AI가 MCP로 「별의 숲」 3화를 수정했어요", summary(MCP_WORK_CHANGED, ep = 3))
        assertEquals("AI가 MCP로 「별의 숲」을 수정했어요", summary(MCP_WORK_CHANGED))
        assertEquals("AI가 MCP로 「바다」를 수정했어요", summary(MCP_WORK_CHANGED, title = "바다"))
        assertEquals("AI가 MCP로 「용의 땅」의 설정 카드 「검」을 수정했어요", summary(MCP_WORLD_CHANGED, title = "용의 땅", subject = "설정 카드 「검」"))
        assertEquals("AI가 MCP로 「용의 땅」을 수정했어요", summary(MCP_WORLD_CHANGED, title = "용의 땅", ep = 2))
    }

    @Test
    fun `a title that does not end in hangul or a digit gets both particles`() {
        assertEquals("AI가 MCP로 「Fork 2」를 수정했어요", summary(MCP_WORK_CHANGED, title = "Fork 2"))
        assertEquals("AI가 MCP로 「Fork 1」을 수정했어요", summary(MCP_WORK_CHANGED, title = "Fork 1"))
        assertEquals("AI가 MCP로 「Dawn」을(를) 수정했어요", summary(MCP_WORK_CHANGED, title = "Dawn"))
    }

    @Test
    fun `a clipped title or phrase picks the particle from the last kept letter`() {
        assertEquals("AI가 MCP로 「${"가".repeat(39)}숲…」을 수정했어요", summary(MCP_WORK_CHANGED, title = "가".repeat(39) + "숲나무"))
        assertEquals("AI가 MCP로 「별의 숲」 ${"다".repeat(60)}…를 수정했어요", summary(MCP_WORK_CHANGED, subject = "다".repeat(70)))
    }

    @Test
    fun `a title cut at an emoji keeps the whole code point instead of half a surrogate pair`() {
        val text = summary(MCP_WORK_CHANGED, title = "가".repeat(39) + "😀" + "나무")
        assertTrue(text.indices.all { !text[it].isHighSurrogate() || text[it + 1].isLowSurrogate() }, text)
        assertEquals("AI가 MCP로 「${"가".repeat(39)}😀…」을(를) 수정했어요", text)
    }

    @Test
    fun `ai changes keep the object phrase so a bundle can say how many more changes it holds`() {
        assertEquals("「별의 숲」 3화 원고", NoticeSummary.of(MCP_WORK_CHANGED, NoticeDetail("별의 숲", 3, "원고")).subject)
        assertEquals("AI가 MCP로 「별의 숲」 3화 원고 외 2건을 수정했어요", NoticeSummary.bundled("「별의 숲」 3화 원고", 2))
        assertNull(NoticeSummary.of(MCP_WORK_CHANGED, null).subject)
        assertNull(NoticeSummary.of(OPERATOR_WORK_RESTRICTED, NoticeDetail("별의 숲")).subject)
    }

    @Test
    fun `operator restrictions name the work or episode and add the reason only when there is one`() {
        assertEquals("운영자가 「별의 숲」 3화를 제한했어요 · 사유: 저작권 침해 신고", summary(OPERATOR_WORK_RESTRICTED, ep = 3, reason = "저작권 침해 신고"))
        assertEquals("운영자가 「별의 숲」을 제한했어요", summary(OPERATOR_WORK_RESTRICTED, reason = " "))
        assertEquals("운영자가 「별의 숲」 3화 제한을 해제했어요", summary(OPERATOR_WORK_UNRESTRICTED, ep = 3, reason = "무시"))
        assertEquals("운영자가 「용의 땅」 세계관을 제한했어요 · 사유: 신고", summary(OPERATOR_WORLD_RESTRICTED, title = "용의 땅", reason = "신고"))
        assertEquals("운영자가 「용의 땅」 세계관 제한을 해제했어요", summary(OPERATOR_WORLD_UNRESTRICTED, title = "용의 땅"))
    }

    @Test
    fun `comment and new episode notices name the work and episode`() {
        assertEquals("운영자가 「별의 숲」 3화에 남긴 내 댓글을 숨겼어요", summary(OPERATOR_COMMENT_HIDDEN, ep = 3))
        assertEquals("운영자가 숨긴 「별의 숲」 3화의 내 댓글을 다시 게시했어요", summary(OPERATOR_COMMENT_RESTORED, ep = 3))
        assertEquals("관심 작품 「별의 숲」에 4화가 올라왔어요", summary(EPISODE_PUBLISHED, ep = 4))
        assertEquals("관심 작품 「별의 숲」에 새 회차가 올라왔어요", summary(EPISODE_PUBLISHED))
    }

    @Test
    fun `long or multi-line text is folded and clipped so the summary always fits the notice limit`() {
        assertEquals("AI가 MCP로 「별의 숲」 원고를 수정했어요", summary(MCP_WORK_CHANGED, title = " 별의\n  숲 ", subject = "원고"))
        val long = summary(OPERATOR_WORK_RESTRICTED, title = "가".repeat(500), ep = 999_999, reason = "나".repeat(500))
        assertTrue(long.length <= 300, "${long.length}")
        assertTrue(long.contains("「${"가".repeat(40)}…」"), long)
        val bundled = NoticeSummary.bundled(requireNotNull(NoticeSummary.of(MCP_WORK_CHANGED, NoticeDetail("가".repeat(500), 1, "다".repeat(500))).subject), 999_999)
        assertTrue(bundled.length <= 300, "${bundled.length}")
    }
}
