package ai.storyfork.content.proposal

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.proposal.domain.WritingSelection
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class WritingSelectionTest {
    private val body = "문이 닫혔다. 그는 웃었다. 창밖은 어두웠다."

    @Test fun `selection returns only the chosen span with surrounding read-only text`() {
        val s = WritingSelection.of(body, 8, 15)

        assertEquals("그는 웃었다.", s.before)
        assertEquals("문이 닫혔다. ", s.preceding)
        assertEquals(" 창밖은 어두웠다.", s.following)
        assertEquals("8:15", s.position)
    }

    @Test fun `applying a patch replaces the span and keeps every other character`() {
        assertEquals("문이 닫혔다. 그는 조용히 웃었다. 창밖은 어두웠다.", WritingSelection.apply(body, "8:15", "그는 조용히 웃었다."))
    }

    @Test fun `invalid, blank, oversized or surrogate-splitting selections are rejected`() {
        val emoji = "가😀나"
        listOf({ WritingSelection.of(body, 5, 5) }, { WritingSelection.of(body, -1, 3) }, { WritingSelection.of(body, 0, body.length + 1) },
            { WritingSelection.of("a  b", 1, 3) }, { WritingSelection.of("가".repeat(5001), 0, 5001) },
            { WritingSelection.of(emoji, 0, 2) }).forEach {
            assertEquals(422, assertThrows(ContentFailure::class.java) { it() }.status)
        }
    }

    @Test fun `surrounding text is capped at 2000 characters`() {
        val long = "가".repeat(3000) + "선택" + "나".repeat(3000)
        val s = WritingSelection.of(long, 3000, 3002)

        assertEquals(2000, s.preceding.length)
        assertEquals(2000, s.following.length)
    }
}
