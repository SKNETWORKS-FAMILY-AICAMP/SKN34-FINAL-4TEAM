package ai.storyfork.content.fork

import ai.storyfork.content.episode_version.entity.EpisodeVersionEntity
import ai.storyfork.content.fork.service.forkManuscriptHash
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ForkIntegrityTest {
    @Test fun `the hash ignores row IDs and order but detects changed or missing manuscript content`() {
        val a=EpisodeVersionEntity(id="origin-a",contentVersionId="a",revisionNo=1,title="원고",content="본문",authorNote="후기")
        val b=EpisodeVersionEntity(id="origin-b",contentVersionId="b",revisionNo=2,title="다른 회차",content="다른 본문")
        val copy=EpisodeVersionEntity(id="fork-a",contentVersionId="a",revisionNo=1,title="원고",content="본문",authorNote="후기")
        val expected=forkManuscriptHash(listOf(1 to a,3 to b))
        assertEquals(64,expected.length)
        assertEquals(expected,forkManuscriptHash(listOf(3 to b,1 to copy)))
        assertNotEquals(expected,forkManuscriptHash(listOf(1 to copy)))
        copy.authorNote="바뀐 후기"
        assertNotEquals(expected,forkManuscriptHash(listOf(1 to copy,3 to b)))
    }
}
