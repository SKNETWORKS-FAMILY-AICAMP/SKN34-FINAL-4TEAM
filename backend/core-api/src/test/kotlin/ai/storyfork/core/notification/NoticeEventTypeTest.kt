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
        assertTrue(listOfNotNull(expiring, withdrawal).none { it.kind.mutable })
    }

    @Test
    fun `lookup is exact and unknown codes are null`() {
        assertEquals(NoticeEventType.WORLD_CHANGED, NoticeEventType.fromCode("content.world.changed"))
        assertNull(NoticeEventType.fromCode("CONTENT.WORLD.CHANGED"))
        assertNull(NoticeEventType.fromCode(""))
    }
}
