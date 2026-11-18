package ai.storyfork.content.world

import ai.storyfork.content.attachment.client.AttachmentStorageClient
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
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.support.TransactionTemplate

/**
 * 카드 본문·관계 본문의 링크 `[글자](card:<uuid>)`(DEC-53)가 비작가 출구마다 같은 함수로 치환되는지 확인한다: 독자 설정 위키·공개 세계관 상세·Fork 이어받기(REST)와 그 MCP 도구.
 * 대상이 그 응답의 보이는 카드가 아니면(작가 전용·기준 회차 뒤·없는 id) 글자만 남고 id가 응답 어디에도 없어야 하고, 보이는 카드로 가는 링크는 그대로 남는다.
 * 저장소·Core·Neo4j는 대역이고 서비스는 실제 객체를 이어 붙인다([WorldCardRevealExitsTest]와 같은 방식).
 */
class WorldCardLinkExitsTest {
    private val owner = "member-1"
    private val worldId = UUID.randomUUID()
    private val revisionId = UUID.randomUUID()

    private val worlds = mock(StudioWorldRepository::class.java)
    private val revisions = mock(WorldRevisionRepository::class.java)
    private val revisionCards = mock(WorldRevisionCardRepository::class.java)
    private val cardVersions = mock(SettingCardVersionRepository::class.java)
    private val states = mock(WorldRelationshipStateRepository::class.java)
    private val graph = mock(Neo4jRelationshipRepository::class.java)
    private val works = mock(WorkRepository::class.java)
    private val access = mock(WorkAccessService::class.java)
    private val publication = mock(PublicationService::class.java)
    private val references = mock(ForkWorldReferenceRepository::class.java)
    private val manager = mock(PlatformTransactionManager::class.java).also {
        `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() }
    }
    private val publicWorlds = PublicWorldService(worlds, revisions, revisionCards, cardVersions, mock(SettingCardImageRepository::class.java), states, mock(ExpandedSeedProgressRepository::class.java), graph,
        mock(CoreNicknameService::class.java), mock(AttachmentStorageClient::class.java), works, access, mock(ContentImageRepository::class.java), publication, manager)
    private val workWorlds = WorkWorldService(access, works, publication, mock(StudioWorldRepository::class.java), publicWorlds, references, TransactionTemplate(manager))
    private val specs = SyncMcpAnnotationProviders.statelessToolSpecifications(listOf<Any>(
        WorkMcpTools(mock(WorkService::class.java), workWorlds, mock(WorkNoticeService::class.java), mock(ForkService::class.java), mock(ContextService::class.java), mock(ProposalService::class.java)),
        WorldStudioMcpTools(mock(WorldStudioService::class.java), workWorlds, publicWorlds, mock(InitialWorldAnalysisService::class.java), mock(InitialWorldApplicationService::class.java)),
    ))

    @AfterEach fun clear() = SecurityContextHolder.clearContext()

    private val a = UUID.randomUUID()
    private val b = UUID.randomUUID()
    private val authorOnly = UUID.randomUUID()
    private val late = UUID.randomUUID() // 5화부터 공개
    private val gone = UUID.randomUUID() // 이 세계관에 없는 id(지운 카드·다른 세계관)
    private val upper = authorOnly.toString().uppercase()

    private fun card(id: UUID, title: String, reveal: Int?, body: String) = SettingCardVersion(cardId = id, worldId = worldId, versionNo = 1, fields = CardFields(title = title, body = body, cardType = "character",
        semanticMetadata = reveal?.let { mapOf<String, Any?>("revealFromEpisode" to it) } ?: emptyMap(), visibility = "private"))

    private val cards = listOf(
        card(a, "갑", 1, "[을](card:$b) [작가](card:$authorOnly) [뒤](card:$late) [없는](card:$gone) [대문자](card:$upper) `[코드](card:$authorOnly)` <card:$authorOnly> [꺾쇠](<card:$authorOnly>) [제목](card:$authorOnly \"t\") [[겹]](card:$authorOnly) <card:$late>"),
        card(b, "을", 1, "[갑](card:$a)"),
        card(authorOnly, "작가 전용", null, "숨은 카드 [갑](card:$a)"),
        card(late, "뒤", 5, "5화에 공개"),
    )
    private val relation = RelationshipPayload(UUID.randomUUID(), a, b, "structural", label = "동료", body = "[을](card:$b)과 [작가](card:$authorOnly)와 [뒤](card:$late) <card:$authorOnly>")
    private val hiddenEnd = RelationshipPayload(UUID.randomUUID(), authorOnly, a, "structural", label = "숨은 관계", body = "")

    init {
        val world = StudioWorld(worldId, UUID.randomUUID(), revisionId, visibility = "public", genre = "fantasy", publishedAt = Instant.parse("2026-11-11T01:02:03Z"))
        `when`(worlds.findById(worldId)).thenReturn(Optional.of(world))
        `when`(revisions.findByIdAndWorldId(revisionId, worldId)).thenReturn(WorldRevision(id = revisionId, worldId = worldId, revisionNo = 3, name = "세계", description = "설명", sealed = true))
        `when`(revisionCards.findAllByIdRevisionId(revisionId)).thenReturn(cards.map { WorldRevisionCard(RevisionCardKey(revisionId, it.cardId), worldId, it.id) })
        `when`(cardVersions.findAllById(cards.map { it.id })).thenReturn(cards)
        `when`(states.findById(worldId)).thenReturn(Optional.of(WorldRelationshipState(worldId, 3, "creation", "key", "hash", 1, true)))
        listOf(1, 2, 3, 4, 5, 9).forEach { e -> `when`(graph.read(worldId, e)).thenReturn(RelationshipStateResult(worldId, 3, "key", "hash", listOf(relation, hiddenEnd))) }
    }

    private val linkedWork = WorkEntity(id = "work", ownerId = owner, title = "연결된 소설", worldStudioId = worldId)

    private fun link(published: Int) {
        `when`(works.findAllByWorldStudioIdIn(listOf(worldId))).thenReturn(listOf(linkedWork))
        `when`(works.findById("work")).thenReturn(Optional.of(linkedWork))
        `when`(access.get("work")).thenReturn(WorkAccessResult("work", owner, "연결된 소설", "", 1, "legacy-world", "public", false, false, null))
        `when`(publication.publishedEpisodes("work")).thenReturn(PublishedEpisodeListResponse((1..published).map { PublishedEpisodeResponse(it, 1, "v${it}", "${it}화", "본문") }))
        `when`(access.own("fork", owner)).thenReturn(WorkAccessResult("fork", owner, "분기", "", 1, "legacy-world", "private", false, false, SourceResponse("work", "원작", published, 1, "")))
        `when`(works.findById("fork")).thenReturn(Optional.of(WorkEntity(id = "fork", ownerId = owner, title = "분기")))
        `when`(references.findById("fork")).thenReturn(Optional.of(ForkWorldReferenceEntity("fork", "legacy-world", "following")))
    }

    private fun signedIn(): McpTransportContext {
        SecurityContextHolder.getContext().authentication = UsernamePasswordAuthenticationToken.authenticated(owner, null, emptyList())
        return mcpCallerContext()
    }

    private fun mcp(tool: String, args: Map<String, Any?>, context: McpTransportContext = McpTransportContext.EMPTY): String {
        val result = specs.single { it.tool().name() == tool }.callHandler().apply(context, CallToolRequest.builder(tool).arguments(args).build())
        assertNotEquals(true, result.isError(), tool)
        return (result.content().single() as TextContent).text()
    }

    /** 기준 회차 [basis]에서 보이는 카드는 갑·을(1화)과, 5화 이상이면 뒤다. 작가 전용·없는 id는 어느 기준에서도 숨는다. */
    private fun expectedA(basis: Int) = "[을](card:$b) 작가 ${if (basis >= 5) "[뒤](card:$late)" else "뒤"} 없는 대문자 `코드` <> [꺾쇠](<>) [제목]( \"t\") [[겹]]() ${if (basis >= 5) "<card:$late>" else "<>"}"
    private fun expectedRelation(basis: Int) = "[을](card:$b)과 작가와 ${if (basis >= 5) "[뒤](card:$late)" else "뒤"} <>"

    /** 응답 전체(글자 그대로)에 숨은 카드의 id가 없다. 대문자로 쓴 id도 없다. */
    private fun assertNoHiddenId(exit: String, dump: String, basis: Int) {
        val hidden = listOf(authorOnly, gone) + (if (basis < 5) listOf(late) else emptyList())
        hidden.forEach { assertFalse(dump.lowercase().contains(it.toString()), "${exit} @${basis} 숨은 id ${it}") }
    }

    @Test fun `every outsider exit leaves only the text of a link whose target is not a shown card, and keeps links to shown cards`() {
        listOf(3, 5).forEach { basis ->
            link(published = basis)
            val wiki = workWorlds.readerCards("work", null)
            val detail = publicWorlds.detail(worldId)
            val inherited = workWorlds.inheritedWorld("fork", owner, null)
            assertEquals(expectedA(basis), wiki.cards.single { it.id == a }.text, "위키 카드 @${basis}")
            assertEquals("[갑](card:$a)", wiki.cards.single { it.id == b }.text, "위키 보이는 대상 @${basis}")
            assertEquals(expectedRelation(basis), wiki.relationships.single().body, "위키 관계 본문 @${basis}")
            assertEquals(expectedA(basis), detail.cards.single { it.id == a }.text, "공개 상세 카드 @${basis}")
            assertEquals(expectedRelation(basis), detail.relationships.single().body, "공개 상세 관계 본문 @${basis}")
            assertEquals(expectedA(basis), inherited.cards.single { it.id == a }.body, "Fork 카드 @${basis}")
            assertNoHiddenId("위키", wiki.toString(), basis)
            assertNoHiddenId("공개 상세", detail.toString(), basis)
            assertNoHiddenId("Fork", inherited.toString(), basis)
            // MCP 도구도 같은 Service를 거치므로 같은 결과다. 응답 JSON 어디에도 숨은 id가 없다.
            val texts = mapOf(
                "work_public_world_cards" to mcp("work_public_world_cards", mapOf("id" to "work")),
                "work_inherited_world" to mcp("work_inherited_world", mapOf("id" to "fork"), signedIn()),
                "world_studio_public_read" to mcp("world_studio_public_read", mapOf("id" to worldId.toString())),
            )
            texts.forEach { (tool, text) ->
                assertNoHiddenId(tool, text, basis)
                assertTrue(text.contains("card:$b"), "${tool} 보이는 대상 링크는 그대로 @${basis}")
            }
        }
    }
}
