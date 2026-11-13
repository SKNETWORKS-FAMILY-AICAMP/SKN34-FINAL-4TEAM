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
    private val answers = mock(ManuscriptQaClient::class.java)
    private val worlds = mock(ai.storyfork.content.world.service.WorldService::class.java)
    private val service = ManuscriptQaService(scopeService, index, embeddings, episodes, versions, answers, worlds)
    private val request = ManuscriptQaRequest(2, "r2", "무슨 일이 있었나요?", true)
    private val scopeRequest = QaScopeRequest(2, "r2", "manuscript")
    private val scope = QaScope("fork", "original", 2, "r2", listOf(QaEpisodeRef(1, "r1"), QaEpisodeRef(2, "r2")), null)
    private val body = "🐉 용이 나타났다."
    private val hash = PublishedManuscript("fork", "original", "episode", 2, "r2", body).chunks().single().sourceHash
    private val hit = ManuscriptHit("chunk", "fork", "original", "episode", 2, "r2", hash, 3, body.length, 1)
    private val vector = listOf(0.3f)

    private fun prepare(vararg hits: ManuscriptHit) {
        `when`(scopeService.resolve("fork", null, scopeRequest)).thenReturn(scope)
        `when`(embeddings.query(request.question)).thenReturn(vector)
        `when`(index.search(scope, vector)).thenReturn(hits.toList())
        `when`(episodes.findAllByWorkIdOrderBySequence("fork")).thenReturn(listOf(EpisodeCurrentEntity("episode", "fork", 2, "row")))
        `when`(versions.findAllById(listOf("row"))).thenReturn(listOf(EpisodeVersionEntity(id="row", episodeId="episode", contentVersionId="r2", content=body)))
    }

    @Test
    fun `verified text alone is cited and missing coverage is returned`() {
        prepare(hit, hit.copy(id="foreign", workId="other"), hit.copy(id="wrong-pair", episode=1), hit.copy(id="surrogate", start=1))
        val excerpt = QaExcerpt("chunk", 2, "용이 나타났다.")
        val claim = QaClaim("용이 등장했어요.", "confirmed", listOf("chunk"))
        `when`(answers.answer(request.question, listOf(excerpt))).thenReturn(ManuscriptQaResult(listOf(claim), listOf("용이 온 이유")))
        val response = service.ask("fork", null, request)
        assertEquals("partial", response.status)
        assertEquals(listOf(claim), response.claims)
        assertEquals("용이 나타났다.", response.sources.single().quote)
        assertEquals(listOf(QaEpisodeRef(1, "r1")), response.coverage.withoutVerifiedExcerpt)
        assertTrue(response.gaps.any { it.code == "UNVERIFIED_HIT" })
        assertTrue(response.gaps.any { it.detail == "용이 온 이유" })
    }

    @Test
    fun `stale hash and missing matches never go to the model`() {
        prepare(hit.copy(sourceHash="old"))
        assertEquals("insufficient", service.ask("fork", null, request).status)
        verifyNoInteractions(answers)
    }

    @Test
    fun `missing consent prevents retrieval and foreign model citations fail closed`() {
        assertThrows(ContentFailure::class.java) { service.ask("fork", null, request.copy(consent=false)) }
        verifyNoInteractions(index, embeddings, answers)
        prepare(hit)
        `when`(answers.answer(request.question, listOf(QaExcerpt("chunk", 2, "용이 나타났다."))))
            .thenReturn(ManuscriptQaResult(listOf(QaClaim("검증 불가", "confirmed", listOf("unknown"))), emptyList()))
        assertEquals(502, assertThrows(ContentFailure::class.java) { service.ask("fork", null, request) }.status)
    }

    @Test
    fun `a scope change during generation rejects the answer`() {
        prepare(hit)
        `when`(scopeService.resolve("fork", null, scopeRequest)).thenReturn(scope, scope, scope.copy(episodes=listOf(scope.episodes.last())))
        `when`(answers.answer(request.question, listOf(QaExcerpt("chunk", 2, "용이 나타났다."))))
            .thenReturn(ManuscriptQaResult(emptyList(), listOf("모름")))
        assertEquals(409, assertThrows(ContentFailure::class.java) { service.ask("fork", null, request) }.status)
    }

    @Test
    fun `reader settings use the scoped public projection and discard an answer when it changes`() {
        val setting = ai.storyfork.content.world.service.dto.ReadingDocumentResponse(
            "setting-id", "s1", "place", "서고", "은색 열쇠가 필요하다.", emptyList(), emptyList(), emptyList(),
            "", null, null, null, emptyList(), emptyList(), emptyList(),
        )
        `when`(scopeService.resolve("fork", null, scopeRequest.copy(target = "setting"))).thenReturn(scope)
        `when`(worlds.settingsForQa("fork", null, 2)).thenReturn(listOf(setting), listOf(setting), listOf(setting), emptyList())
        val sources = listOf(QaExcerpt("setting:setting-id", 2, setting.body, "setting", setting.name))
        val claim = QaClaim("은색 열쇠가 필요해요.", "confirmed", listOf("setting:setting-id"))
        `when`(answers.answer(request.question, sources)).thenReturn(ManuscriptQaResult(listOf(claim), emptyList()))
        val query = request.copy(target = "setting")
        val response = service.ask("fork", null, query)
        assertEquals("answered", response.status)
        assertEquals("s1", (response.sources.single() as QaSettingSource).versionId)
        assertTrue(response.coverage.expected.isEmpty())
        assertEquals(409, assertThrows(ContentFailure::class.java) { service.ask("fork", null, query) }.status)
        verifyNoInteractions(index, embeddings)
    }

    @Test
    fun `reader relationship questions fail before loading any current graph`() {
        assertEquals(403, assertThrows(ContentFailure::class.java) {
            service.ask("fork", null, request.copy(target = "relationship"))
        }.status)
        verifyNoInteractions(scopeService, index, embeddings, worlds, answers)
    }

    @Test
    fun `current relationship cites graph version and rechecks it after generation`() {
        val owner = UUID.randomUUID().toString()
        val from = CardPayload(UUID.randomUUID(), "리안", "카드 비공개 본문", "character", "")
        val to = from.copy(id = UUID.randomUUID(), title = "카엘")
        val edge = RelationshipPayload(UUID.randomUUID(), from.id, to.id, null, label = "동맹", direction = "directed")
        val graph = WorldDraftResponse(UUID.randomUUID(), 7, null, null, "세계", "", listOf(from, to),
            listOf(edge, edge.copy(id = UUID.randomUUID(), targetCardId = null)), relationshipVersion = 3)
        `when`(scopeService.resolve("fork", owner, scopeRequest)).thenReturn(scope)
        `when`(scopeService.currentRelationships(scope, owner)).thenReturn(graph, graph, graph, graph.copy(relationshipVersion = 4))
        val id = "relationship:${edge.id}"
        val excerpt = QaExcerpt(id, 2, "동맹", "relationship", "리안 → 카엘")
        val claim = QaClaim("리안과 카엘은 동맹이에요.", "confirmed", listOf(id))
        `when`(answers.answer(request.question, listOf(excerpt))).thenReturn(ManuscriptQaResult(listOf(claim), emptyList()))
        val query = request.copy(target = "relationship")
        val source = service.ask("fork", owner, query).sources.single() as QaRelationshipSource
        assertEquals(3L, source.graphVersion)
        assertEquals(graph.worldId, source.worldId)
        assertEquals(409, assertThrows(ContentFailure::class.java) { service.ask("fork", owner, query) }.status)
        verifyNoInteractions(index, embeddings, worlds)
    }
}
