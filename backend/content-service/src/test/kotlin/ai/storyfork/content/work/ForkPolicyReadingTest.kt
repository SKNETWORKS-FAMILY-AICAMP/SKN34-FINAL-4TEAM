package ai.storyfork.content.work

import ai.storyfork.content.work.domain.forkableEpisodes
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ForkPolicyReadingTest {
    @Test fun `all from and selected policies use only published episode numbers`() {
        assertEquals(listOf(1,2,3),forkableEpisodes(true,"all",null,emptyList(),listOf(1,2,3)))
        assertEquals(listOf(2,3),forkableEpisodes(true,"from",2,emptyList(),listOf(1,2,3)))
        assertEquals(listOf(1,3),forkableEpisodes(true,"selected",null,listOf(3,1,4),listOf(1,2,3)))
        assertEquals(emptyList<Int>(),forkableEpisodes(false,"all",null,emptyList(),listOf(1,2)))
        assertEquals(emptyList<Int>(),forkableEpisodes(true,"from",null,emptyList(),listOf(1,2)))
    }
}
