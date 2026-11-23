package ai.storyfork.content.context

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.context.service.*
import ai.storyfork.content.context.service.dto.*
import ai.storyfork.content.episode.entity.EpisodeCurrentEntity
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode_version.entity.EpisodeVersionEntity
import ai.storyfork.content.episode_version.repository.EpisodeVersionRepository
import ai.storyfork.content.manuscript.client.*
import ai.storyfork.content.manuscript.client.dto.*
import ai.storyfork.content.manuscript.service.PublishedManuscript
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.web.client.HttpClientErrorException

class ManuscriptQaTest {
    private val scopeService = mock(QaScopeService::class.java)
    private val index = mock(ManuscriptElasticsearch::class.java)
    private val embeddings = mock(ManuscriptEmbeddingClient::class.java)
    private val episodes = mock(EpisodeCurrentRepository::class.java)
    private val versions = mock(EpisodeVersionRepository::class.java)
    private val grants = QaScopeGrants()
    private val service = ManuscriptQaService(scopeService, index, embeddings, episodes, versions, grants)
    private val question = "무슨 일이 있었나요?"
    private val scopeRequest = QaScopeRequest(2, "r2")
    private val scope = QaScope("fork", "original", 2, "r2", listOf(QaEpisodeRef(1, "r1"), QaEpisodeRef(2, "r2")))
    private val body = "🐉 용이 나타났다."
    private val hash = PublishedManuscript("fork", "original", "episode", 2, "r2", body).chunks().single().sourceHash
    private val hit = ManuscriptHit("chunk", "fork", "original", "episode", 2, "r2", hash, 3, body.length, 1)
    private val vector = listOf(0.3f)

    private fun prepare(vararg hits: ManuscriptHit) {
        `when`(scopeService.resolve("fork", null, scopeRequest)).thenReturn(scope)
        `when`(embeddings.query(question)).thenReturn(vector)
        `when`(index.search(scope, vector)).thenReturn(hits.toList())
        `when`(episodes.findAllByWorkIdOrderBySequence("fork")).thenReturn(listOf(EpisodeCurrentEntity("episode", "fork", 2, "row")))
        `when`(versions.findAllById(listOf("row"))).thenReturn(listOf(EpisodeVersionEntity(id="row", episodeId="episode", contentVersionId="r2", content=body)))
    }

    /** Content가 서명한 조회 키로 AI Retrieval을 부른다. owner가 null이면 독자 범위다. */
    private fun retrieve() = service.retrieveForAi(QaRetrievalRequest(grants.issue(QaScopeGrant("fork", null, 2, "r2")), question))

    @Test
    fun `ai retrieval returns verified excerpts and step metrics without calling the model or consent`() {
        prepare(hit, hit.copy(id="foreign", workId="other"), hit.copy(id="wrong-pair", episode=1), hit.copy(id="surrogate", start=1))
        val result = retrieve()
        assertEquals("found", result.status)
        assertEquals(listOf(QaExcerpt("chunk", 2, "용이 나타났다.")), result.excerpts)
        assertEquals(listOf("embedding" to 1, "elasticsearch" to 4, "postgres_verify" to 1), result.steps.map { it.provider to it.hits })
        assertEquals(listOf(QaEpisodeRef(1, "r1")), result.coverage.withoutVerifiedExcerpt)
        assertTrue(result.gaps.any { it.code == "UNVERIFIED_HIT" })
    }

    @Test
    fun `stale hash never becomes evidence`() {
        prepare(hit.copy(sourceHash="old"))
        val result = retrieve()
        assertEquals("insufficient", result.status)
        assertTrue(result.gaps.any { it.code == "NO_EVIDENCE" })
    }

    @Test
    fun `a scope change during search is rejected`() {
        prepare(hit)
        `when`(scopeService.resolve("fork", null, scopeRequest)).thenReturn(scope, scope.copy(episodes=listOf(scope.episodes.last())))
        assertEquals(409, assertThrows(ContentFailure::class.java) { retrieve() }.status)
    }

    @Test
    fun `ai retrieval rejects a scope token Content did not sign`() {
        val forged = QaScopeGrants().issue(QaScopeGrant("fork", "forged-owner", 2, "r2"))
        assertEquals(403, assertThrows(ContentFailure::class.java) {
            service.retrieveForAi(QaRetrievalRequest(forged, question))
        }.status)
        verifyNoInteractions(scopeService)
    }

    // ---- 자율 연재 회차 실행의 관련 장면 검색(독자 범위)

    private val basis = QaEpisodeRef(2, "r2")

    @Test
    fun `a serial related search reads the reader scope and returns the verified quotes up to the limit`() {
        prepare(hit, hit.copy(id = "chunk2", start = 4), hit.copy(id = "foreign", workId = "other"), hit.copy(id = "chunk3", start = 5))

        val found = service.searchRelated("fork", question, basis, 2)

        // 독자 범위(owner 없음)로 확정하고, 검증을 통과한 인용만 검색 순서대로 limit개다.
        assertEquals(listOf("chunk", "chunk2"), found.map { it.id })
        assertEquals(listOf("용이 나타났다.", "이 나타났다."), found.map { it.quote })
        assertEquals(listOf(2, 2), found.map { it.episode })
        verify(scopeService, atLeastOnce()).resolve("fork", null, scopeRequest)
        verify(embeddings).query(question)
    }

    @Test
    fun `a serial related search with nothing verified is an empty list and not a failure`() {
        prepare(hit.copy(sourceHash = "old"))

        assertEquals(emptyList<QaSource>(), service.searchRelated("fork", question, basis, 6))
    }

    @Test
    fun `a work with no reader scope has nothing indexed so the serial search is an empty list`() {
        // 비공개·제한 작품은 색인되지 않았고 독자 범위(공개 작품 확인)를 만들 수 없다: 임베딩도 검색도 부르지 않는다.
        `when`(scopeService.resolve("fork", null, scopeRequest)).thenThrow(ContentFailure(404, "공개 작품을 찾을 수 없어요."))

        assertEquals(emptyList<QaSource>(), service.searchRelated("fork", question, basis, 6))
        verifyNoInteractions(embeddings, index)
    }

    @Test
    fun `a basis episode that readers cannot see leaves no reader scope so the serial search is an empty list`() {
        // 원작이 삭제된 Fork의 상속 회차처럼 독자에게 가려진 기준 회차는 범위 확정이 422다: 색인된 것이 없으니 실행을 막지 않고 빈 목록이다.
        `when`(scopeService.resolve("fork", null, scopeRequest)).thenThrow(ContentFailure(422, "공개된 회차를 기준으로 선택해 주세요."))

        assertEquals(emptyList<QaSource>(), service.searchRelated("fork", question, basis, 6))
        verifyNoInteractions(embeddings, index)
    }

    @Test
    fun `an embedding 422 for a query that is too long is an error and not an empty list`() {
        // 범위 확정의 422(독자에게 가려진 기준 회차)만 '없음'이다. 검색 단계의 422는 질문이 너무 길다는 실패라 그대로 전파한다.
        prepare(hit)
        doThrow(HttpClientErrorException.create(HttpStatus.UNPROCESSABLE_ENTITY, "too long", HttpHeaders(), ByteArray(0), null)).`when`(embeddings).query(question)

        assertEquals(422, assertThrows(ContentFailure::class.java) { service.searchRelated("fork", question, basis, 6) }.status)
    }

    @Test
    fun `a failed embedding call is an error the serial run turns into its own failure`() {
        prepare(hit)
        doThrow(org.springframework.web.client.ResourceAccessException("down")).`when`(embeddings).query(question)

        assertEquals(503, assertThrows(ContentFailure::class.java) { service.searchRelated("fork", question, basis, 6) }.status)
    }

    @Test
    fun `an incomplete index search is an error and not an empty list`() {
        prepare(hit)
        doThrow(IllegalStateException("Incomplete manuscript search")).`when`(index).search(scope, vector)

        assertEquals(503, assertThrows(ContentFailure::class.java) { service.searchRelated("fork", question, basis, 6) }.status)
    }

    @Test
    fun `a scope that changed during the serial search is rejected`() {
        prepare(hit)
        `when`(scopeService.resolve("fork", null, scopeRequest)).thenReturn(scope, scope.copy(episodes = listOf(scope.episodes.last())))

        assertEquals(409, assertThrows(ContentFailure::class.java) { service.searchRelated("fork", question, basis, 6) }.status)
    }
}
