package ai.storyfork.core.notification

import ai.storyfork.core.notification.domain.NoticeEventType
import ai.storyfork.core.notification.domain.NoticeKind
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class NoticeEventTypeTest {
    @Test
    fun `codes are unique routing keys and summaries fit the notice limit`() {
        assertEquals(NoticeEventType.entries.size, NoticeEventType.entries.map { it.code }.toSet().size)
        assertTrue(NoticeEventType.entries.all { it.summary.length in 1..300 && it.code.contains('.') })
    }

    @Test
    fun `a new episode of an interest work is a reading notice that targets the work`() {
        val type = NoticeEventType.fromCode("content.episode.published")
        assertEquals(NoticeEventType.EPISODE_PUBLISHED, type)
        assertEquals(NoticeKind.READING, type?.kind)
        assertEquals("work", type?.targetType)
        assertEquals("관심 작품에 새 회차가 올라왔어요", type?.summary)
    }

    @Test
    fun `core events are credit and rights notices that members cannot turn off`() {
        val expiring = NoticeEventType.fromCode("core.credit.expiring")
        assertEquals(NoticeEventType.CREDIT_EXPIRING, expiring)
        assertEquals(NoticeKind.CREDIT, expiring?.kind)
        assertEquals("credit-expiry", expiring?.targetType)
        val withdrawal = NoticeEventType.fromCode("core.member.withdrawal-requested")
        assertEquals(NoticeEventType.WITHDRAWAL_REQUESTED, withdrawal)
        assertEquals(NoticeKind.RIGHTS_SECURITY, withdrawal?.kind)
        assertEquals("withdrawal", withdrawal?.targetType)
        // 로그인만으로는 복구되지 않으므로(프로필에서 취소해야 함) 안내도 취소 동작을 말한다.
        assertEquals("탈퇴가 요청됐어요. 유예 기간 안에 프로필에서 탈퇴 요청을 취소하면 복구할 수 있어요", withdrawal?.summary)
        assertTrue(listOfNotNull(expiring, withdrawal).none { it.kind.mutable })
    }

    @Test
    fun `lookup is exact and unknown codes are null`() {
        assertEquals(NoticeEventType.WORLD_CHANGED, NoticeEventType.fromCode("content.world.changed"))
        assertNull(NoticeEventType.fromCode("CONTENT.WORLD.CHANGED"))
        assertNull(NoticeEventType.fromCode(""))
    }
}
