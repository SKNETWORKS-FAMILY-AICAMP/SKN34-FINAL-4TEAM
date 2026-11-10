package ai.storyfork.content.work

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode_version.repository.*
import ai.storyfork.content.fork.repository.*
import ai.storyfork.content.publication.entity.WorkPublicationHistoryEntity
import ai.storyfork.content.publication.repository.WorkPublicationHistoryRepository
import ai.storyfork.content.work.entity.*
import ai.storyfork.content.work.repository.*
import ai.storyfork.content.work.service.*
import jakarta.persistence.EntityManager
import java.time.Instant
import java.util.Optional
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

/** 소프트 삭제된 작품은 소유자 조회·공개 조회에서 404이고 행은 그대로 읽힌다(DEC-42). 저장소 mock으로 검증한다. */
class WorkAccessSoftDeleteTest {
    private val works = mock(WorkRepository::class.java)
    private val worlds = mock(WorkWorldHistoryRepository::class.java)
    private val visibility = mock(WorkPublicationHistoryRepository::class.java)
    private val access = WorkAccessService(works, worlds, visibility, mock(ForkPolicyHistoryRepository::class.java),
        mock(ForkPolicyEpisodeRepository::class.java), mock(ForkRepository::class.java), mock(CheckpointRepository::class.java),
        mock(EpisodeRepository::class.java), mock(EpisodeVersionRepository::class.java), mock(EntityManager::class.java))

    private fun work(deleted: Boolean) {
        val row = WorkEntity(id = "w", ownerId = "author", title = "작품")
        if (deleted) row.deletedAt = Instant.parse("2026-11-10T00:00:00Z")
        `when`(works.findById("w")).thenReturn(Optional.of(row))
        `when`(worlds.findFirstByWorkIdOrderByRevisionNoDesc("w")).thenReturn(WorkWorldHistoryEntity(workId = "w", worldId = "world"))
        `when`(visibility.findFirstByWorkIdOrderByRevisionNoDesc("w")).thenReturn(WorkPublicationHistoryEntity(workId = "w", visibility = "public"))
    }

    @Test fun `a deleted work is flagged but still readable by id`() {
        work(true)
        assertTrue(access.get("w").deleted)
    }

    @Test fun `the owner gets 404 for a deleted work`() {
        work(true)
        assertEquals(404, assertThrows(ContentFailure::class.java) { access.own("w", "author") }.status)
    }

    @Test fun `readers get 404 for a deleted public work`() {
        work(true)
        assertEquals(404, assertThrows(ContentFailure::class.java) { access.published("w") }.status)
    }

    @Test fun `a live public work stays readable by the owner and readers`() {
        work(false)
        assertEquals("w", access.own("w", "author").id)
        assertEquals("w", access.published("w").id)
    }
}
