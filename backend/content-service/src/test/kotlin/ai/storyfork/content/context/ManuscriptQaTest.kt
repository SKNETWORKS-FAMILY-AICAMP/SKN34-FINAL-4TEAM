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
import ai.storyfork.content.world.service.dto.CardPayload
import ai.storyfork.content.world.service.dto.RelationshipPayload
import ai.storyfork.content.world.service.dto.WorldDraftResponse
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

class ManuscriptQaTest {
    private val scopeService = mock(QaScopeService::class.java)
    private val index = mock(ManuscriptElasticsearch::class.java)
    private val embeddings = mock(ManuscriptEmbeddingClient::class.java)
    private val episodes = mock(EpisodeCurrentRepository::class.java)
    private val versions = mock(EpisodeVersionRepository::class.java)
    private val worlds = mock(ai.storyfork.content.world.service.WorldService::class.java)
    private val grants = QaScopeGrants()
    private val service = ManuscriptQaService(scopeService, index, embeddings, episodes, versions, worlds, grants)
    private val question = "무슨 일이 있었나요?"
    private val scopeRequest = QaScopeRequest(2, "r2", "manuscript")
    private val scope = QaScope("fork", "original", 2, "r2", listOf(QaEpisodeRef(1, "r1"), QaEpisodeRef(2, "r2")), null)
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
    private fun retrieve(target: String = "manuscript", owner: String? = null) =
        service.retrieveForAi(QaRetrievalRequest(grants.issue(QaScopeGrant("fork", owner, 2, "r2", target)), question))

    @Test
    fun `ai retrieval returns verified excerpts and step metrics without calling the model or consent`() {
        prepare(hit, hit.copy(id="foreign", workId="other"), hit.copy(id="wrong-pair", episode=1), hit.copy(id="surrogate", start=1))
        val result = retrieve()
        assertEquals("found", result.status)
        assertEquals(listOf(QaExcerpt("chunk", 2, "용이 나타났다.", "manuscript", "")), result.excerpts)
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
    fun `reader settings use the scoped public projection without searching the manuscript`() {
        val setting = ai.storyfork.content.world.service.dto.ReadingDocumentResponse(
            "setting-id", "s1", "place", "서고", "은색 열쇠가 필요하다.", emptyList(), emptyList(), emptyList(),
            "", null, null, null, emptyList(), emptyList(), emptyList(),
        )
        `when`(scopeService.resolve("fork", null, scopeRequest.copy(target = "setting"))).thenReturn(scope)
        `when`(worlds.settingsForQa("fork", null, 2)).thenReturn(listOf(setting))
        val result = retrieve("setting")
        assertEquals(listOf(QaExcerpt("setting:setting-id", 2, setting.body, "setting", setting.name)), result.excerpts)
        assertEquals("s1", (result.sources.single() as QaSettingSource).versionId)
        assertTrue(result.coverage.expected.isEmpty())
        verifyNoInteractions(index, embeddings)
    }

    @Test
    fun `current relationship cites graph version and carries card links as plain text`() {
        val owner = UUID.randomUUID().toString()
        val from = CardPayload(UUID.randomUUID(), "리안", "카드 비공개 본문", "character", "")
        val to = from.copy(id = UUID.randomUUID(), title = "카엘")
        val edge = RelationshipPayload(UUID.randomUUID(), from.id, to.id, null, label = "동맹", body = "[승상](card:${UUID.randomUUID()})과 맺었다", direction = "directed")
        val graph = WorldDraftResponse(UUID.randomUUID(), 7, null, null, "세계", "", listOf(from, to),
            listOf(edge, edge.copy(id = UUID.randomUUID(), targetCardId = null)), relationshipVersion = 3)
        `when`(scopeService.resolve("fork", owner, scopeRequest)).thenReturn(scope)
        `when`(scopeService.currentRelationships(scope, owner)).thenReturn(graph)
        val result = retrieve("relationship", owner)
        assertEquals(listOf(QaExcerpt("relationship:${edge.id}", 2, "동맹\n승상과 맺었다", "relationship", "리안 → 카엘")), result.excerpts)
        val source = result.sources.single() as QaRelationshipSource
        assertEquals(3L, source.graphVersion)
        assertEquals(graph.worldId, source.worldId)
        verifyNoInteractions(index, embeddings, worlds)
    }

    @Test
    fun `ai retrieval keeps the reader relationship guard and rejects unsigned scope`() {
        for (token in listOf(grants.issue(QaScopeGrant("fork", null, 2, "r2", "relationship")),
            QaScopeGrants().issue(QaScopeGrant("fork", "forged-owner", 2, "r2", "relationship")))) {
            assertEquals(403, assertThrows(ContentFailure::class.java) {
                service.retrieveForAi(QaRetrievalRequest(token, question))
            }.status)
        }
        verifyNoInteractions(scopeService)
    }
}
