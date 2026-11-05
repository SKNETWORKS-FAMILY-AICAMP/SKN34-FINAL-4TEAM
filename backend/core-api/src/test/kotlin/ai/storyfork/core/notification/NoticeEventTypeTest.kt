package ai.storyfork.core.notification

import ai.storyfork.core.notification.domain.NoticeEventType
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
    fun `lookup is exact and unknown codes are null`() {
        assertEquals(NoticeEventType.WORLD_CHANGED, NoticeEventType.fromCode("content.world.changed"))
        assertNull(NoticeEventType.fromCode("CONTENT.WORLD.CHANGED"))
        assertNull(NoticeEventType.fromCode(""))
    }
}
