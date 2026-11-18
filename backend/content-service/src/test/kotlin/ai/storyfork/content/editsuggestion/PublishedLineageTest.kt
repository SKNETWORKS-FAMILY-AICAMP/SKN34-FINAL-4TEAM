package ai.storyfork.content.editsuggestion

import ai.storyfork.content.episode_version.domain.publishedLineage
import ai.storyfork.content.episode_version.domain.VersionLink
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class PublishedLineageTest {
    @Test fun `ordinary saves inherit but restoring an older version skips the abandoned branch`() {
        val rows = listOf(VersionLink("episode","a",null), VersionLink("episode","approved",null),
            VersionLink("episode","next",null), VersionLink("episode","restored","a"),
            VersionLink("episode","later",null), VersionLink("episode","back","next"))
        assertEquals(setOf("a","approved","next"), publishedLineage(rows,"next"))
        assertEquals(setOf("a","restored","later"), publishedLineage(rows,"later"))
        assertEquals(setOf("a","approved","next","back"), publishedLineage(rows,"back"))
        assertEquals(emptySet<String>(), publishedLineage(rows,null))
    }
}
