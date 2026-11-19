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
}
