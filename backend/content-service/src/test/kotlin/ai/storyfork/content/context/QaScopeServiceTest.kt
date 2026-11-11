package ai.storyfork.content.context

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.context.service.QaScopeService
import ai.storyfork.content.context.service.dto.QaEpisodeRef
import ai.storyfork.content.context.service.dto.QaScopeRequest
import ai.storyfork.content.context.service.dto.QaWorldRef
import ai.storyfork.content.episode.entity.EpisodeEntity
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.fork.service.dto.SourceResponse
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublishedEpisodeListResponse
import ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.WorldDraftResponse
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

/** Q&A가 읽을 작품/Fork·회차·판본·세계관 범위는 요청 값이 아니라 Content 정본으로 확정한다. */
class QaScopeServiceTest {
    private val owner = UUID.randomUUID()
    private val world = UUID.randomUUID()
    private val access = mock(WorkAccessService::class.java)
    private val publication = mock(PublicationService::class.java)
    private val episodes = mock(EpisodeRepository::class.java)
    private val worlds = mock(WorldStudioService::class.java)
    private val service = QaScopeService(access, publication, episodes, worlds)

    private fun work(id: String, source: SourceResponse? = null, visibility: String = "public") =
        WorkAccessResult(id, owner.toString(), "작품", "", 0, "world", visibility, false, false, source)
    private fun published(id: String, vararg items: PublishedEpisodeResponse) =
        `when`(publication.publishedEpisodes(id)).thenReturn(PublishedEpisodeListResponse(items.toList()))
    private fun ownWork() {
        `when`(access.own("work", owner.toString())).thenReturn(work("work"))
        published("work", PublishedEpisodeResponse(1, 1, "w1", "1화", "본문1"),
            PublishedEpisodeResponse(2, 2, "w2", "2화", "본문2"), PublishedEpisodeResponse(3, 1, "w3", "3화", "본문3"))
    }
    private fun request(episode: Int? = 2, version: String = "w2", target: String = "manuscript", at: String = "current") =
        QaScopeRequest(episode, version, target, at)
    private fun failure(block: () -> Unit) = assertThrows(ContentFailure::class.java) { block() }

    @Test fun `own work fixes episodes up to the basis with server versions`() {
        ownWork()
        val scope = service.resolve("work", owner.toString(), request())
        assertEquals("work", scope.workId)
        assertEquals(listOf(QaEpisodeRef(1, "w1"), QaEpisodeRef(2, "w2")), scope.episodes)
        assertNull(scope.world)
    }

    @Test fun `another author's work is not found and nothing else is read`() {
        `when`(access.own("other", owner.toString())).thenThrow(ContentFailure(404, "작품을 찾을 수 없어요."))
        assertEquals(404, failure { service.resolve("other", owner.toString(), request()) }.status)
        verifyNoInteractions(publication, episodes, worlds)
    }

    @Test fun `a private work is not readable as a reader`() {
        `when`(access.published("private")).thenThrow(ContentFailure(404, "공개 작품을 찾을 수 없어요."))
        assertEquals(404, failure { service.resolve("private", null, request()) }.status)
        verifyNoInteractions(publication)
    }

    @Test fun `a version from another fork is rejected and fork scope keeps its own inherited versions`() {
        `when`(access.own("fork", owner.toString())).thenReturn(work("fork", SourceResponse("original", "원작", 1, 1, "")))
        published("fork", PublishedEpisodeResponse(1, 1, "o1", "분기 전", "원작", true), PublishedEpisodeResponse(2, 1, "f2", "내 회차", "내 글"))
        assertEquals(409, failure { service.resolve("fork", owner.toString(), request(version = "otherFork2")) }.status)
        val scope = service.resolve("fork", owner.toString(), request(version = "f2"))
        assertEquals("original", scope.sourceWorkId)
        assertEquals(listOf(QaEpisodeRef(1, "o1"), QaEpisodeRef(2, "f2")), scope.episodes)
    }

    @Test fun `readers of a fork whose original was deleted get no inherited episodes`() {
        `when`(access.published("fork")).thenReturn(work("fork", SourceResponse("original", "원작", 1, 1, "", deleted = true)))
        published("fork", PublishedEpisodeResponse(1, 1, "o1", "분기 전", "원작", true), PublishedEpisodeResponse(2, 1, "f2", "내 회차", "내 글"))
        assertEquals(listOf(QaEpisodeRef(2, "f2")), service.resolve("fork", null, request(version = "f2")).episodes)
    }

    @Test fun `an unpublished or missing basis episode is out of range`() {
        ownWork()
        assertEquals(422, failure { service.resolve("work", owner.toString(), request(episode = 4, version = "w4")) }.status)
        assertEquals(422, failure { service.resolve("work", owner.toString(), request(episode = null)) }.status)
        assertEquals(422, failure { service.resolve("work", owner.toString(), request(episode = 0)) }.status)
    }

    @Test fun `a stale version is a conflict, not an empty scope`() {
        ownWork()
        assertEquals(409, failure { service.resolve("work", owner.toString(), request(version = "w2-old")) }.status)
    }

    @Test fun `invalid target and blank version are rejected before any read`() {
        assertEquals(422, failure { service.resolve("work", owner.toString(), request(target = "everything")) }.status)
        assertEquals(422, failure { service.resolve("work", owner.toString(), request(version = " ")) }.status)
        verifyNoInteractions(access, publication)
    }

    @Test fun `relationships come only from the world linked to the basis episode at its current graph token`() {
        ownWork()
        `when`(episodes.findByWorkIdAndSequence("work", 2)).thenReturn(EpisodeEntity(id = "e2", workId = "work", sequence = 2, basisWorldId = world))
        `when`(worlds.draft(world, owner)).thenReturn(WorldDraftResponse(world, 1, null, null, "세계", "", emptyList(), emptyList(), relationshipVersion = 7))
        val scope = service.resolve("work", owner.toString(), request(target = "relationship"))
        assertEquals(world, scope.world?.worldId)
        assertEquals(7L, scope.world?.relationshipVersion)
    }

    @Test fun `an inherited fork episode uses the world the original author linked to that episode`() {
        val author = UUID.randomUUID()
        `when`(access.own("fork", owner.toString())).thenReturn(work("fork", SourceResponse("original", "원작", 1, 1, "")))
        `when`(access.get("original")).thenReturn(WorkAccessResult("original", author.toString(), "원작", "", 0, "world", "public", true, false, null))
        published("fork", PublishedEpisodeResponse(1, 1, "o1", "분기 전", "원작", true), PublishedEpisodeResponse(2, 1, "f2", "내 회차", "내 글"))
        `when`(episodes.findByWorkIdAndSequence("original", 1)).thenReturn(EpisodeEntity(id = "s1", workId = "original", sequence = 1, basisWorldId = world))
        `when`(worlds.draft(world, author)).thenReturn(WorldDraftResponse(world, 1, null, null, "원작 세계", "", emptyList(), emptyList(), relationshipVersion = 3))
        val scope = service.resolve("fork", owner.toString(), request(episode = 1, version = "o1", target = "relationship"))
        assertEquals(QaWorldRef(world, 3), scope.world)
        verify(episodes, never()).findByWorkIdAndSequence("fork", 1)
    }

    @Test fun `a fork's own episode never borrows the original's world`() {
        `when`(access.own("fork", owner.toString())).thenReturn(work("fork", SourceResponse("original", "원작", 1, 1, "")))
        published("fork", PublishedEpisodeResponse(1, 1, "o1", "분기 전", "원작", true), PublishedEpisodeResponse(2, 1, "f2", "내 회차", "내 글"))
        `when`(episodes.findByWorkIdAndSequence("fork", 2)).thenReturn(EpisodeEntity(id = "f2", workId = "fork", sequence = 2))
        assertEquals("WORLD_LINK_REQUIRED", failure { service.resolve("fork", owner.toString(), request(version = "f2", target = "relationship")) }.code)
        verify(episodes, never()).findByWorkIdAndSequence("original", 2)
        verifyNoInteractions(worlds)
    }

    @Test fun `an episode without a linked world is unsupported for relationships`() {
        ownWork()
        `when`(episodes.findByWorkIdAndSequence("work", 2)).thenReturn(EpisodeEntity(id = "e2", workId = "work", sequence = 2))
        val error = failure { service.resolve("work", owner.toString(), request(target = "relationship")) }
        assertEquals(422, error.status)
        assertEquals("WORLD_LINK_REQUIRED", error.code)
        verifyNoInteractions(worlds)
    }

    @Test fun `a linked world the caller does not own is not found`() {
        ownWork()
        `when`(episodes.findByWorkIdAndSequence("work", 2)).thenReturn(EpisodeEntity(id = "e2", workId = "work", sequence = 2, basisWorldId = world))
        `when`(worlds.draft(world, owner)).thenThrow(WorldNotFound())
        assertEquals(404, failure { service.resolve("work", owner.toString(), request(target = "relationship")) }.status)
    }

    @Test fun `graph store failures keep their code instead of becoming empty relationships`() {
        ownWork()
        `when`(episodes.findByWorkIdAndSequence("work", 2)).thenReturn(EpisodeEntity(id = "e2", workId = "work", sequence = 2, basisWorldId = world))
        `when`(worlds.draft(world, owner)).thenThrow(WorldStudioFailure.unavailable())
        val error = failure { service.resolve("work", owner.toString(), request(target = "relationship")) }
        assertEquals(503, error.status)
        assertEquals("RELATIONSHIP_STORE_UNAVAILABLE", error.code)
    }

    @Test fun `past relationships are unsupported and readers cannot read relationships yet`() {
        val history = failure { service.resolve("work", owner.toString(), request(target = "relationship", at = "episode")) }
        assertEquals(409, history.status)
        assertEquals("RELATIONSHIP_HISTORY_UNSUPPORTED", history.code)
        `when`(access.published("work")).thenReturn(work("work"))
        published("work", PublishedEpisodeResponse(2, 2, "w2", "2화", "본문2"))
        assertEquals(403, failure { service.resolve("work", null, request(target = "relationship")) }.status)
        verifyNoInteractions(episodes, worlds)
    }
}
