package ai.storyfork.content.work

import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode_version.repository.*
import ai.storyfork.content.fork.entity.ForkEntity
import ai.storyfork.content.fork.repository.*
import ai.storyfork.content.fork.service.dto.SourceResponse
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

/** 원작이 삭제된 Fork도 원작·체크포인트 조회 없이 "삭제된 원작" 정보로 조회되는지 저장소 mock으로 검증한다. */
class WorkAccessSeveredForkTest {
    private val works = mock(WorkRepository::class.java)
    private val worlds = mock(WorkWorldHistoryRepository::class.java)
    private val visibility = mock(WorkPublicationHistoryRepository::class.java)
    private val forks = mock(ForkRepository::class.java)
    private val checkpoints = mock(CheckpointRepository::class.java)
    private val access = WorkAccessService(works, worlds, visibility, mock(ForkPolicyHistoryRepository::class.java),
        mock(ForkPolicyEpisodeRepository::class.java), forks, checkpoints, mock(EpisodeRepository::class.java),
        mock(EpisodeVersionRepository::class.java), mock(EntityManager::class.java))

    private fun fork(id: String) {
        `when`(works.findById(id)).thenReturn(Optional.of(WorkEntity(id = id, ownerId = "reader", title = "분기 작품", originKind = "fork")))
        `when`(worlds.findFirstByWorkIdOrderByRevisionNoDesc(id)).thenReturn(WorkWorldHistoryEntity(workId = id, worldId = "world-$id"))
        `when`(visibility.findFirstByWorkIdOrderByRevisionNoDesc(id)).thenReturn(WorkPublicationHistoryEntity(workId = id, visibility = "private"))
    }

    @Test fun `a Fork whose source was deleted still reads as a Fork marked deleted without touching the checkpoint`() {
        fork("fork")
        `when`(forks.findById("fork")).thenReturn(Optional.of(ForkEntity(workId = "fork", sourceWorkId = null, sourceCheckpointId = null,
            ownerId = "reader", sourceTitle = "삭제된 원작 제목", direction = "새 방향", sourceDeletedAt = Instant.parse("2026-11-10T00:00:00Z"),
            basisEpisode = 3, basisVersion = 2)))

        val source = access.get("fork").source

        assertEquals(SourceResponse("", "삭제된 원작 제목", 3, 2, "새 방향", deleted = true), source)
        verifyNoInteractions(checkpoints)
    }

    @Test fun `an original work without a fork row still has no source`() {
        fork("fork")
        `when`(forks.findById("fork")).thenReturn(Optional.empty())

        assertNull(access.get("fork").source)
    }
}
