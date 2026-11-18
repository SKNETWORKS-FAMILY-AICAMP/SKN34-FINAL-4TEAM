package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.attachment.client.dto.AttachmentObjectResult
import ai.storyfork.content.attachment.repository.ContentImageRepository
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.context.service.ContextService
import ai.storyfork.content.fork.entity.ForkWorldReferenceEntity
import ai.storyfork.content.fork.repository.ForkWorldReferenceRepository
import ai.storyfork.content.fork.service.ForkService
import ai.storyfork.content.fork.service.dto.SourceResponse
import ai.storyfork.content.mcp.WorkMcpTools
import ai.storyfork.content.mcp.WorldStudioMcpTools
import ai.storyfork.content.mcp.mcpCallerContext
import ai.storyfork.content.notice.service.WorkNoticeService
import ai.storyfork.content.proposal.service.ProposalService
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublishedEpisodeListResponse
import ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import ai.storyfork.content.world.relationship.Neo4jRelationshipRepository
import ai.storyfork.content.world.service.InitialWorldAnalysisService
import ai.storyfork.content.world.service.InitialWorldApplicationService
import ai.storyfork.content.world.service.PublicWorldService
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.RelationshipPayload
import ai.storyfork.content.world.service.dto.RelationshipStateResult
import ai.storyfork.content.world.studio.entity.*
import ai.storyfork.content.world.studio.repository.*
import io.modelcontextprotocol.common.McpTransportContext
import io.modelcontextprotocol.spec.McpSchema.CallToolRequest
import io.modelcontextprotocol.spec.McpSchema.TextContent
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.*
import org.springframework.ai.mcp.annotation.spring.SyncMcpAnnotationProviders
import org.springframework.data.domain.PageImpl
import org.springframework.data.domain.PageRequest
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.support.TransactionTemplate

/**
 * 설정 카드의 공개 기준이 하나(DEC-53)인지 비작가 출구마다 확인한다: 독자 설정 위키·공개 세계관 상세(카드 페이지가 읽는 응답)·목록의 카드/관계 수·카드 이미지 두 경로·Fork 이어받기(REST)·MCP 도구.
 * 비공개+회차N / 공개+회차N / 공개+없음 / 비공개+없음 네 조합 × 기준 회차(N-1·N)에서 보이는 카드와 그 시점의 관계가 모든 출구에서 같아야 하고 N화 뒤의 관계는 어디에도 나오지 않는다.
 * 저장소·Core·Neo4j는 대역이며 실제 HTTP·쿼리는 CI의 통합 테스트가 확인한다. 서비스는 대역 없이 실제 객체를 이어 붙인다(출구가 같은 규칙을 쓰는지 보려고).
 */
class WorldCardRevealExitsTest {
    private val n = 3
    private val owner = "member-1"
    private val worldId = UUID.randomUUID()
    private val revisionId = UUID.randomUUID()

    private val worlds = mock(StudioWorldRepository::class.java)
    private val revisions = mock(WorldRevisionRepository::class.java)
    private val revisionCards = mock(WorldRevisionCardRepository::class.java)
    private val cardVersions = mock(SettingCardVersionRepository::class.java)
    private val images = mock(SettingCardImageRepository::class.java)
    private val states = mock(WorldRelationshipStateRepository::class.java)
    private val expandedSeeds = mock(ExpandedSeedProgressRepository::class.java)
    private val graph = mock(Neo4jRelationshipRepository::class.java)
    private val nicknames = mock(CoreNicknameService::class.java)
    private val storage = mock(AttachmentStorageClient::class.java)
    private val works = mock(WorkRepository::class.java)
    private val access = mock(WorkAccessService::class.java)
    private val workImages = mock(ContentImageRepository::class.java)
    private val publication = mock(PublicationService::class.java)
    private val studios = mock(StudioWorldRepository::class.java)
    private val references = mock(ForkWorldReferenceRepository::class.java)
    private val manager = mock(PlatformTransactionManager::class.java).also {
        `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() }
    }
    private val publicWorlds = PublicWorldService(worlds, revisions, revisionCards, cardVersions, images, states, expandedSeeds, graph, nicknames, storage, works, access, workImages, publication, manager)
    private val workWorlds = WorkWorldService(access, works, publication, studios, publicWorlds, references, TransactionTemplate(manager))
    private val specs = SyncMcpAnnotationProviders.statelessToolSpecifications(listOf<Any>(
        WorkMcpTools(mock(WorkService::class.java), workWorlds, mock(WorkNoticeService::class.java), mock(ForkService::class.java), mock(ContextService::class.java), mock(ProposalService::class.java)),
        WorldStudioMcpTools(mock(WorldStudioService::class.java), workWorlds, publicWorlds, mock(InitialWorldAnalysisService::class.java), mock(InitialWorldApplicationService::class.java)),
    ))

    @AfterEach fun clear() = SecurityContextHolder.clearContext()

    /** 한 세계관의 카드 하나다. 이미지가 하나씩 있어 이미지 출구도 카드와 같은 규칙인지 본다. */
    private inner class Combo(val title: String, visibility: String, reveal: Int?) {
        val image: UUID = UUID.randomUUID()
        val version = SettingCardVersion(cardId = UUID.randomUUID(), worldId = worldId, versionNo = 1, fields = CardFields(title = title, body = "${title} 본문", cardType = "character",
            semanticMetadata = mapOf<String, Any?>("imageId" to image.toString()) + (reveal?.let { mapOf("revealFromEpisode" to it) } ?: emptyMap()), visibility = visibility))
    }
    private val privateAtN = Combo("비공개3", "private", n)
    private val publicAtN = Combo("공개3", "public", n)
    private val publicOnly = Combo("공개만", "public", null)
    private val authorOnly = Combo("작가전용", "private", null)
    private val combos = listOf(privateAtN, publicAtN, publicOnly, authorOnly)

    /** [from]화에 처음 기록된 관계다. 그 회차 시점부터 읽힌다. */
    private class Edge(val from: Int, val relation: RelationshipPayload)
    private fun edge(from: Int, a: Combo, b: Combo, label: String, body: String = "") =
        Edge(from, RelationshipPayload(UUID.randomUUID(), a.version.cardId, b.version.cardId, "structural", label = label, body = body))
    private val edges = listOf(
        edge(1, publicOnly, publicAtN, "동료"),
        edge(1, publicOnly, authorOnly, "작가만 아는 사이"),
        edge(n, publicOnly, privateAtN, "정체", "3화에 밝혀진 사실"),
        edge(5, publicOnly, publicAtN, "5화의 반전", "스포일러"),
    )
    private fun asOf(episode: Int?) = edges.filter { episode == null || it.from <= episode }.map { it.relation }

    private val shownTitles = mapOf(n - 1 to setOf("공개만"), n to setOf("비공개3", "공개3", "공개만"))
    private val shownLabels = mapOf(n - 1 to emptySet<String>(), n to setOf("동료", "정체"))

    init {
        val world = StudioWorld(worldId, UUID.randomUUID(), revisionId, visibility = "public", genre = "fantasy", publishedAt = Instant.parse("2026-11-11T01:02:03Z"))
        `when`(worlds.findById(worldId)).thenReturn(Optional.of(world))
        val revision = WorldRevision(id = revisionId, worldId = worldId, revisionNo = 3, name = "세계", description = "설명", sealed = true)
        val state = WorldRelationshipState(worldId, 3, "creation", "key", "hash", 1, true)
        `when`(revisions.findByIdAndWorldId(revisionId, worldId)).thenReturn(revision)
        `when`(revisionCards.findAllByIdRevisionId(revisionId)).thenReturn(combos.map { WorldRevisionCard(RevisionCardKey(revisionId, it.version.cardId), worldId, it.version.id) })
        `when`(cardVersions.findAllById(combos.map { it.version.id })).thenReturn(combos.map { it.version })
        `when`(states.findById(worldId)).thenReturn(Optional.of(state))
        // 관계는 요청한 회차 시점의 것만 돌려준다. null(최신)은 5화의 관계까지 주므로 어느 출구든 이를 부르면 아래 never 검증이 잡는다.
        listOf<Int?>(null, 0, 1, 2, 3, 4, 5, 9).forEach { e -> `when`(graph.read(worldId, e)).thenReturn(RelationshipStateResult(worldId, 3, "key", "hash", asOf(e))) }
        combos.forEach {
            `when`(images.findById(it.image)).thenReturn(Optional.of(SettingCardImage(it.image, worldId, "world-card-images/${it.image}", "image/png")))
            `when`(storage.read("world-card-images/${it.image}")).thenReturn(AttachmentObjectResult(byteArrayOf(1)))
        }
        val page = PageRequest.of(0, 24)
        `when`(worlds.listed(page)).thenReturn(PageImpl(listOf(world), page, 1))
        `when`(revisions.findAllById(listOf(revisionId))).thenReturn(listOf(revision))
        `when`(revisionCards.cardVersionsOf(listOf(revisionId))).thenReturn(combos.map { arrayOf<Any>(revisionId, it.version) })
        `when`(states.findAllById(listOf(worldId))).thenReturn(listOf(state))
    }

    private val linkedWork = WorkEntity(id = "work", ownerId = owner, title = "연결된 소설", worldStudioId = worldId)

    /** 세계관에 연결된 소설이 1~[published]화를 발행한 상태다. [published]가 0이면 발행한 회차가 없고, [visibility]가 public이 아니면 공개 작품이 아니다. */
    private fun link(published: Int, visibility: String = "public") {
        `when`(works.findAllByWorldStudioIdIn(listOf(worldId))).thenReturn(listOf(linkedWork))
        `when`(works.findById("work")).thenReturn(Optional.of(linkedWork))
        `when`(access.get("work")).thenReturn(WorkAccessResult("work", owner, "연결된 소설", "", 1, "legacy-world", visibility, false, false, null))
        `when`(publication.publishedEpisodes("work")).thenReturn(PublishedEpisodeListResponse((1..published).map { PublishedEpisodeResponse(it, 1, "v${it}", "${it}화", "본문") }))
        // 공개 목록은 같은 값을 페이지 전체 쿼리로 읽는다: 공개 작품이면 [작품 id, 마지막 발행 회차] 행이 있고 아니면 행이 없다.
        `when`(works.lastPublishedOfPublicWorks(listOf("work"))).thenReturn(if (visibility == "public") listOf(arrayOf<Any>("work", published)) else emptyList())
    }

    /** 원작 [linkedWork]의 [basisEpisode]화에서 갈라진 Fork가 자기 세계관 없이 원작 세계관을 이어받는 상태다. */
    private fun fork(basisEpisode: Int) {
        `when`(access.own("fork", owner)).thenReturn(WorkAccessResult("fork", owner, "분기", "", 1, "legacy-world", "private", false, false, SourceResponse("work", "원작", basisEpisode, 1, "")))
        `when`(works.findById("fork")).thenReturn(Optional.of(WorkEntity(id = "fork", ownerId = owner, title = "분기")))
        `when`(references.findById("fork")).thenReturn(Optional.of(ForkWorldReferenceEntity("fork", "legacy-world", "following")))
    }

    private class Seen(val titles: Set<String>, val labels: Set<String>, val bodies: Set<String>)

    private fun assertSeen(exit: String, seen: Seen, basis: Int) {
        assertEquals(shownTitles.getValue(basis), seen.titles, "${exit} 카드 @${basis}")
        assertEquals(shownLabels.getValue(basis), seen.labels, "${exit} 관계 @${basis}")
        // 기준 회차 뒤(5화)에 기록된 관계의 글은 어느 출구에도 나오지 않는다.
        assertFalse("스포일러" in seen.bodies, "${exit} 뒤 회차 관계 본문 @${basis}")
    }

    private fun wiki(upto: String? = null) = workWorlds.readerCards("work", upto).let { r -> Seen(r.cards.map { it.title }.toSet(), r.relationships.map { it.label }.toSet(), r.relationships.map { it.body }.toSet()) }
    private fun detail() = publicWorlds.detail(worldId).let { r -> Seen(r.cards.map { it.title }.toSet(), r.relationships.map { it.label }.toSet(), r.relationships.map { it.body }.toSet()) }
    private fun inherited(upto: String? = null) = workWorlds.inheritedWorld("fork", owner, upto).let { r -> Seen(r.cards.map { it.title }.toSet(), r.relationships.map { it.label }.toSet(), r.relationships.map { it.body }.toSet()) }

    /** 이미지가 열리는 카드의 제목이다. 닫힌 이미지는 404여야 하고 그 밖의 실패는 테스트 실패다. */
    private fun openImages(read: (UUID) -> Any) = combos.filter {
        try { read(it.image); true } catch (e: ContentFailure) { assertEquals(404, e.status); false }
    }.map { it.title }.toSet()

    private fun signedIn(): McpTransportContext {
        SecurityContextHolder.getContext().authentication = UsernamePasswordAuthenticationToken.authenticated(owner, null, emptyList())
        return mcpCallerContext()
    }

    private fun mcp(tool: String, args: Map<String, Any?>, context: McpTransportContext = McpTransportContext.EMPTY): String {
        val result = specs.single { it.tool().name() == tool }.callHandler().apply(context, CallToolRequest.builder(tool).arguments(args).build())
        assertNotEquals(true, result.isError(), tool)
        return (result.content().single() as TextContent).text()
    }

    private fun assertMcp(tool: String, text: String, basis: Int) {
        combos.forEach { assertEquals(it.title in shownTitles.getValue(basis), text.contains("\"title\":\"${it.title}\""), "${tool} 카드 ${it.title} @${basis}") }
        edges.map { it.relation.label }.forEach { assertEquals(it in shownLabels.getValue(basis), text.contains("\"label\":\"${it}\""), "${tool} 관계 ${it} @${basis}") }
        assertFalse(text.contains("스포일러"), "${tool} 뒤 회차 관계 본문 @${basis}")
    }

    @Test fun `every outsider exit shows the same cards and relations for the four visibility combinations at the basis episode before and at N`() {
        listOf(n - 1, n).forEach { basis ->
            link(published = basis)
            fork(basis)
            // 독자 설정 위키: upto 생략도, 발행한 회차보다 큰 요청(최댓값까지)도 발행된 마지막 회차 기준이다.
            listOf(null, n.toString(), Int.MAX_VALUE.toString()).forEach { assertSeen("위키 upto=${it}", wiki(it), basis) }
            // 공개 세계관 상세와 카드 페이지: 카드 페이지는 이 응답에서 카드 하나를 찾아 그리므로 이 응답에 없는 카드는 열리지 않는다.
            assertSeen("공개 상세", detail(), basis)
            // Fork 이어받기: 상한은 Fork 기준 회차이고 더 큰 요청도 그 안이다.
            listOf(null, Int.MAX_VALUE.toString()).forEach { assertSeen("Fork upto=${it}", inherited(it), basis) }
            // 목록의 카드·관계 수는 상세와 같은 집합이다.
            val item = publicWorlds.list(null, null, null).items.single()
            assertEquals(shownTitles.getValue(basis).size, item.cardCount, "목록 카드 수 @${basis}")
            assertEquals(shownLabels.getValue(basis).size, item.relationshipCount, "목록 관계 수 @${basis}")
            // 이미지 두 경로.
            assertEquals(shownTitles.getValue(basis), openImages { publicWorlds.cardImage(worldId, it) }, "공개 이미지 @${basis}")
            assertEquals(shownTitles.getValue(basis), openImages { workWorlds.readerCardImage("work", it, null) }, "독자 이미지 @${basis}")
            // MCP 도구도 같은 Service를 거치므로 같은 결과다.
            assertMcp("work_public_world_cards", mcp("work_public_world_cards", mapOf("id" to "work")), basis)
            assertMcp("work_inherited_world", mcp("work_inherited_world", mapOf("id" to "fork"), signedIn()), basis)
            assertMcp("world_studio_public_read", mcp("world_studio_public_read", mapOf("id" to worldId.toString())), basis)
            assertTrue(mcp("world_studio_public_list", emptyMap()).contains("\"cardCount\":${shownTitles.getValue(basis).size}"), "MCP 목록 @${basis}")
        }
        // 어느 출구도 최신 관계(null)를 읽지 않는다: 그러면 5화의 관계가 샌다.
        verify(graph, never()).read(worldId, null)
    }

    @Test fun `a request for a later episode than the last published one reveals nothing more`() {
        link(published = n - 1)
        // 3화 공개 카드는 3화를 발행하기 전에는 upto를 3 이상으로 불러도 나오지 않는다.
        listOf("3", "5", "2147483647").forEach { assertSeen("위키 upto=${it}", wiki(it), n - 1) }
        assertEquals(setOf("공개만"), openImages { workWorlds.readerCardImage("work", it, "2147483647") })
    }

    @Test fun `a public world without a linked work is read at episode 1, and unpublishing the last episode hides the cards again`() {
        // 연결된 소설이 없으면 기준 회차는 1이다: 공개+없음만 보이고 3화 공개 카드는 숨는다.
        assertEquals(setOf("공개만"), detail().titles)
        assertEquals(setOf("공개만"), openImages { publicWorlds.cardImage(worldId, it) })
        assertEquals(1, publicWorlds.list(null, null, null).items.single().cardCount)
        // 3화까지 발행하면 3화 공개 카드가 보이고, 마지막 회차의 공개를 중단하면 다시 숨는다.
        link(published = n)
        assertSeen("공개 상세 3화 발행", detail(), n)
        assertEquals(shownTitles.getValue(n), wiki().titles)
        link(published = n - 1)
        assertSeen("공개 상세 발행 중단", detail(), n - 1)
        assertSeen("위키 발행 중단", wiki(), n - 1)
        assertEquals(shownTitles.getValue(n - 1).size, publicWorlds.list(null, null, null).items.single().cardCount)
        // 발행한 회차가 없거나 공개 작품이 아니면 아무 카드도 보이지 않는다.
        link(published = 0)
        assertTrue(detail().titles.isEmpty())
        link(published = n, visibility = "private")
        assertTrue(detail().titles.isEmpty())
        assertTrue(openImages { publicWorlds.cardImage(worldId, it) }.isEmpty())
    }
}
