package ai.storyfork.core.notification

import ai.storyfork.core.notification.domain.NoticeKind
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class NoticeKindTest {
    @Test
    fun `only reading and creation notices can be turned off`() {
        assertEquals(setOf("reading", "creation"), NoticeKind.entries.filter { it.mutable }.map { it.code }.toSet())
    }

    @Test
    fun `codes are unique and resolvable`() {
        assertEquals(NoticeKind.entries.size, NoticeKind.entries.map { it.code }.toSet().size)
        NoticeKind.entries.forEach { assertSame(it, NoticeKind.fromCode(it.code)) }
        assertNull(NoticeKind.fromCode("unknown"))
    }
}
