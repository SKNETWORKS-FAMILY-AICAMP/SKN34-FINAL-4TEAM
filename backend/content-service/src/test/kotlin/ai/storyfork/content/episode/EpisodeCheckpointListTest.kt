package ai.storyfork.content.episode

import ai.storyfork.content.attachment.repository.ContentImageRepository
import ai.storyfork.content.episode.entity.*
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.EpisodeCheckpointResponse
import ai.storyfork.content.episode_version.entity.EpisodeVersionEntity
import ai.storyfork.content.episode_version.repository.*
import ai.storyfork.content.fork.repository.ForkRepository
import ai.storyfork.content.publication.entity.PublicationEventEntity
import ai.storyfork.content.publication.repository.PublicationEventRepository
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.WorkAccessService
import jakarta.persistence.EntityManager
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.beans.factory.ObjectProvider

/** DEC-43: 회차 체크포인트는 발행(publish·applied) 기록이며, 작가용 회차 응답이 발행 시각 오름차순으로 보여 준다. */
class EpisodeCheckpointListTest {
    private val current = mock(EpisodeCurrentRepository::class.java)
    private val episodes = mock(EpisodeRepository::class.java)
    private val drafts = mock(EpisodeDraftRepository::class.java)
    private val versions = mock(EpisodeVersionRepository::class.java)
    private val events = mock(PublicationEventRepository::class.java)
    @Suppress("UNCHECKED_CAST")
    private val imageProviders = mock(ObjectProvider::class.java) as ObjectProvider<ContentImageRepository>
    private val service = EpisodeService(mock(WorkAccessService::class.java), mock(WorkRepository::class.java), episodes, drafts, current, versions,
        imageProviders, mock(EntityManager::class.java), mock(ForkRepository::class.java), mock(CheckpointEpisodeRepository::class.java), events)
    private val start = Instant.parse("2026-11-01T00:00:00Z")
    private fun saved(vararg names: String) = names.map { EpisodeVersionEntity(id = "id-$it", episodeId = "e", contentVersionId = it, content = "본문 $it") }
    private fun log(id: String, version: String, minute: Long, action: String = "publish", outcome: String = "applied") =
        PublicationEventEntity(id, "id-$version", null, action, outcome, start.plusSeconds(60 * minute), "manual")
    private fun at(minute: Long) = start.plusSeconds(60 * minute).toString()

    /** [published]는 episode_current가 가리키는 현재 공개 버전, [log]는 오래된 순 발행 기록이다. */
    private fun checkpoints(published: String?, saved: List<EpisodeVersionEntity>, log: List<PublicationEventEntity>): List<EpisodeCheckpointResponse> {
        `when`(current.findByWorkIdAndSequence("w", 1)).thenReturn(EpisodeCurrentEntity("e", "w", 1, published?.let { "id-$it" }))
        `when`(episodes.findAllById(listOf("e"))).thenReturn(listOf(EpisodeEntity("e", "w", 1)))
        `when`(drafts.findAllById(listOf("e"))).thenReturn(listOf(EpisodeDraftEntity("e", "제목", "초안", 3)))
        `when`(versions.findAllByEpisodeIdInOrderByCreatedAtAscIdAsc(listOf("e"))).thenReturn(saved)
        if (published != null) `when`(versions.findAllById(listOf("id-$published"))).thenReturn(saved.filter { it.id == "id-$published" })
        `when`(events.findAllByEpisodeVersionIdInOrderByOccurredAtAscIdAsc(saved.map { it.id })).thenReturn(log)
        return service.read("w", "owner", 1).checkpoints
    }

    @Test fun `lists published saved versions oldest first and marks the live one active`() {
        val v = saved("v1", "v2", "v3") // v3은 저장만 하고 발행하지 않았다
        assertEquals(
            listOf(EpisodeCheckpointResponse("v1", at(1), false), EpisodeCheckpointResponse("v2", at(5), true)),
            checkpoints("v2", v, listOf(log("p1", "v1", 1), log("p2", "v2", 5))))
    }

    @Test fun `reverting republishes an earlier version without adding or reordering checkpoints`() {
        val v = saved("v1", "v2")
        assertEquals(
            listOf(EpisodeCheckpointResponse("v1", at(1), true), EpisodeCheckpointResponse("v2", at(5), false)),
            checkpoints("v1", v, listOf(log("p1", "v1", 1), log("p2", "v2", 5), log("p3", "v1", 9))))
    }

    @Test fun `only applied publish records are checkpoints`() {
        val v = saved("v1", "v2")
        assertEquals(
            listOf(EpisodeCheckpointResponse("v2", at(3), true)),
            checkpoints("v2", v, listOf(log("p1", "v1", 1, outcome = "failed"), log("p2", "v1", 2, action = "unpublish"), log("p3", "v2", 3))))
    }

    @Test fun `an unpublished episode has no checkpoint`() {
        assertEquals(emptyList<EpisodeCheckpointResponse>(), checkpoints(null, saved("v1"), emptyList()))
    }
}
