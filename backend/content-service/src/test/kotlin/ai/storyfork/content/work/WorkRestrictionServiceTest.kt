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
import ai.storyfork.content.work.service.dto.InternalWorkResponse
import jakarta.persistence.EntityManager
import java.util.Optional
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

/** 운영 제한 플래그와 공개 접근 차단을 저장소 mock으로 검증한다. */
class WorkRestrictionServiceTest {
    private val works = mock(WorkRepository::class.java)
    private val row = WorkEntity(id = "work", ownerId = "author", title = "작품")

    @Test fun `internal read returns owner title and restriction and 404 for missing work`() {
        `when`(works.findById("work")).thenReturn(Optional.of(row))
        assertEquals(InternalWorkResponse("work", "author", "작품", false), InternalWorkService(works).read("work"))

        `when`(works.findById("none")).thenReturn(Optional.empty())
        assertEquals(404, assertThrows(ContentFailure::class.java) { InternalWorkService(works).read("none") }.status)
    }

    @Test fun `restrict and unrestrict lock the work row and return the new flag`() {
        `when`(works.lockAll(listOf("work"))).thenReturn(listOf(row))
        val service = InternalWorkService(works)

        assertEquals(InternalWorkResponse("work", "author", "작품", true), service.restrict("work", true))
        assertTrue(row.restricted)
        assertEquals(InternalWorkResponse("work", "author", "작품", false), service.restrict("work", false))
        assertFalse(row.restricted)

        `when`(works.lockAll(listOf("none"))).thenReturn(emptyList())
        assertEquals(404, assertThrows(ContentFailure::class.java) { service.restrict("none", true) }.status)
    }

    @Test fun `restricted public work is hidden from public access but still readable by its owner`() {
        val worlds = mock(WorkWorldHistoryRepository::class.java)
        val visibility = mock(WorkPublicationHistoryRepository::class.java)
        val access = WorkAccessService(works, worlds, visibility, mock(ForkPolicyHistoryRepository::class.java),
            mock(ForkPolicyEpisodeRepository::class.java), mock(ForkRepository::class.java), mock(CheckpointRepository::class.java), mock(EpisodeRepository::class.java),
            mock(EpisodeVersionRepository::class.java), mock(EntityManager::class.java))
        `when`(works.findById("work")).thenReturn(Optional.of(row))
        `when`(worlds.findFirstByWorkIdOrderByRevisionNoDesc("work")).thenReturn(WorkWorldHistoryEntity(workId = "work", worldId = "world"))
        `when`(visibility.findFirstByWorkIdOrderByRevisionNoDesc("work")).thenReturn(WorkPublicationHistoryEntity(workId = "work", visibility = "public"))

        assertTrue(access.published("work").publiclyVisible())
        row.restricted = true
        assertFalse(access.get("work").publiclyVisible())
        assertEquals(404, assertThrows(ContentFailure::class.java) { access.published("work") }.status)
        `when`(works.lockAll(listOf("work"))).thenReturn(listOf(row))
        assertEquals("author", access.own("work", "author").ownerId)
    }
}
