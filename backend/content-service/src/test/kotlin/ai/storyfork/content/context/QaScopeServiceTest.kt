package ai.storyfork.content.context

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.context.service.QaScopeService
import ai.storyfork.content.context.service.dto.QaEpisodeRef
import ai.storyfork.content.context.service.dto.QaScopeRequest
import ai.storyfork.content.fork.service.dto.SourceResponse
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublishedEpisodeListResponse
import ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

/** Q&A가 읽을 작품/Fork·회차·판본 범위는 요청 값이 아니라 Content 정본으로 확정한다. */
class QaScopeServiceTest {
    private val owner = UUID.randomUUID()
    private val access = mock(WorkAccessService::class.java)
    private val publication = mock(PublicationService::class.java)
    private val service = QaScopeService(access, publication)

    private fun work(id: String, source: SourceResponse? = null, visibility: String = "public") =
        WorkAccessResult(id, owner.toString(), "작품", "", 0, "world", visibility, false, false, source)
    private fun published(id: String, vararg items: PublishedEpisodeResponse) =
        `when`(publication.publishedEpisodes(id)).thenReturn(PublishedEpisodeListResponse(items.toList()))
    private fun ownWork() {
        `when`(access.own("work", owner.toString())).thenReturn(work("work"))
        published("work", PublishedEpisodeResponse(1, 1, "w1", "1화", "본문1"),
            PublishedEpisodeResponse(2, 2, "w2", "2화", "본문2"), PublishedEpisodeResponse(3, 1, "w3", "3화", "본문3"))
    }
    private fun request(episode: Int? = 2, version: String = "w2") = QaScopeRequest(episode, version)
    private fun failure(block: () -> Unit) = assertThrows(ContentFailure::class.java) { block() }

    @Test fun `own work fixes episodes up to the basis with server versions`() {
        ownWork()
        val scope = service.resolve("work", owner.toString(), request())
        assertEquals("work", scope.workId)
        assertEquals(listOf(QaEpisodeRef(1, "w1"), QaEpisodeRef(2, "w2")), scope.episodes)
    }

    @Test fun `another author's work is not found and nothing else is read`() {
        `when`(access.own("other", owner.toString())).thenThrow(ContentFailure(404, "작품을 찾을 수 없어요."))
        assertEquals(404, failure { service.resolve("other", owner.toString(), request()) }.status)
        verifyNoInteractions(publication)
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

    @Test fun `a blank version is rejected before any read`() {
        assertEquals(422, failure { service.resolve("work", owner.toString(), request(version = " ")) }.status)
        verifyNoInteractions(access, publication)
    }
}
