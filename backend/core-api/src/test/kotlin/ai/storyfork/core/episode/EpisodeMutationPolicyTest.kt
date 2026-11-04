package ai.storyfork.core.episode

import ai.storyfork.core.episode.domain.EpisodeMutationPolicy
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class EpisodeMutationPolicyTest {
    @Test fun `stale editor cannot recreate deleted draft`() {
        assertFalse(EpisodeMutationPolicy.acceptsRevision(4, 5))
        assertTrue(EpisodeMutationPolicy.acceptsRevision(5, 5))
    }
    @Test fun `deletion only permits unreferenced own last episode`() {
        assertTrue(EpisodeMutationPolicy.canDelete(false, false, false))
        assertFalse(EpisodeMutationPolicy.canDelete(true, false, false))
        assertFalse(EpisodeMutationPolicy.canDelete(false, true, false))
        assertFalse(EpisodeMutationPolicy.canDelete(false, false, true))
    }
    @Test fun `order candidates never cross a protected episode`() {
        assertEquals(listOf(3,4), EpisodeMutationPolicy.candidates(3, listOf(1,2,3,4,5), setOf(2,5)))
        assertEquals(emptyList<Int>(), EpisodeMutationPolicy.candidates(2, listOf(1,2,3), setOf(2)))
    }
}
