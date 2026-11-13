package ai.storyfork.content.mcp

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.world.domain.WorldConflict
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.domain.WorldStudioFailure.Reason
import ai.storyfork.content.world.service.AnalysisStorageUnconfirmed
import ai.storyfork.content.world.service.InitialWorldAnalysisRead
import ai.storyfork.content.world.service.InitialWorldAnalysisService
import ai.storyfork.content.world.service.InitialWorldApplicationService
import ai.storyfork.content.world.service.InitialWorldBasis
import ai.storyfork.content.world.service.InitialWorldReviewConflict
import ai.storyfork.content.world.service.PublicWorldService
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.*
import io.modelcontextprotocol.common.McpTransportContext
import io.modelcontextprotocol.server.McpStatelessServerFeatures.SyncToolSpecification
import io.modelcontextprotocol.spec.McpSchema.CallToolRequest
import io.modelcontextprotocol.spec.McpSchema.CallToolResult
import io.modelcontextprotocol.spec.McpSchema.TextContent
import java.util.UUID
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.mockito.stubbing.Answer
import org.springframework.ai.mcp.annotation.spring.SyncMcpAnnotationProviders
import org.springframework.dao.DataAccessResourceFailureException
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.transaction.TransactionSystemException

/** WorldStudio·공개 세계관·분석·반영 도구(17개)가 기존 Service 함수의 어댑터일 뿐임을 확인한다. Spring context 없이 실제 `@McpTool` 호출 경로를 지난다. */
class WorldStudioMcpToolsTest {
    private val studio = mock(WorldStudioService::class.java)
    private val links = mock(WorkWorldService::class.java)
    private val publicWorlds = mock(PublicWorldService::class.java)
    private val analyses = mock(InitialWorldAnalysisService::class.java)
    private val applications = mock(InitialWorldApplicationService::class.java)
    private val specs = toolsOver(studio, links, publicWorlds, analyses, applications)

    private val member = UUID.fromString("11111111-1111-1111-1111-111111111111")
    private val worldId = UUID.fromString("22222222-2222-2222-2222-222222222222")
    private val analysisId = UUID.fromString("33333333-3333-3333-3333-333333333333")
    private val candidateId = UUID.fromString("44444444-4444-4444-4444-444444444444")
    private val applicationId = UUID.fromString("55555555-5555-5555-5555-555555555555")
    private val revisionId = UUID.fromString("66666666-6666-6666-6666-666666666666")

    @AfterEach fun clear() = SecurityContextHolder.clearContext()

    private fun toolsOver(a: WorldStudioService, b: WorkWorldService, c: PublicWorldService, d: InitialWorldAnalysisService, e: InitialWorldApplicationService) =
        SyncMcpAnnotationProviders.statelessToolSpecifications(listOf<Any>(WorldStudioMcpTools(a, b, c, d, e)))

    private fun signedIn(): McpTransportContext {
        SecurityContextHolder.getContext().authentication = UsernamePasswordAuthenticationToken.authenticated("$member", null, emptyList())
        return mcpCallerContext()
    }

    private fun call(tool: String, args: Map<String, Any?>, context: McpTransportContext = McpTransportContext.EMPTY, from: List<SyncToolSpecification> = specs): CallToolResult =
        from.single { it.tool().name() == tool }.callHandler().apply(context, CallToolRequest.builder(tool).arguments(args).build())

    private fun CallToolResult.text() = (content().single() as TextContent).text()

    private fun draft() = WorldDraftResponse(worldId, 1, null, null, "달빛 세계", "설명", emptyList(), emptyList())
    private fun basis() = InitialWorldBasis(1, 0, null, "hash")
    private fun analysis(status: String) = InitialWorldAnalysisResponse(analysisId, basis(), status, "current", null, emptyMap())
    private fun receipt(status: String) = InitialWorldApplicationResponse(applicationId, status, 1, null, emptyList(), emptyList())

    // 로그인이 필요한 도구마다 호출해 볼 수 있는 최소 유효 인자다.
    private val userTools: Map<String, Map<String, Any?>> = mapOf(
        "world_studio_list" to emptyMap(),
        "world_studio_create" to mapOf("request" to mapOf("name" to "달빛 세계", "id" to "$worldId")),
        "world_studio_read" to mapOf("id" to "$worldId"),
        "world_studio_edit_draft" to mapOf("id" to "$worldId", "request" to mapOf("expectedDraftRevision" to 1, "name" to "달빛 세계", "description" to "설명")),
        "world_studio_save_revision" to mapOf("id" to "$worldId", "request" to mapOf("expectedDraftRevision" to 1, "key" to "save-1")),
        "world_studio_update_publication" to mapOf("id" to "$worldId", "request" to mapOf("visibility" to "public", "genre" to "fantasy")),
        "world_studio_revisions" to mapOf("id" to "$worldId"),
        "world_studio_revision_read" to mapOf("id" to "$worldId", "revisionId" to "$revisionId"),
        "world_analysis_create" to mapOf("worldId" to "$worldId", "request" to mapOf("key" to "analyze-1", "expectedDraftRevision" to 1)),
        "world_analysis_list" to mapOf("worldId" to "$worldId"),
        "world_analysis_read" to mapOf("worldId" to "$worldId", "analysisId" to "$analysisId"),
        "world_analysis_candidates" to mapOf("worldId" to "$worldId", "analysisId" to "$analysisId"),
        "world_analysis_decide" to mapOf("worldId" to "$worldId", "analysisId" to "$analysisId", "candidateId" to "$candidateId",
            "request" to mapOf("key" to "decide-1", "expectedDecisionSequence" to 0, "action" to "approve", "editedCandidate" to null, "comment" to "")),
        "world_analysis_apply" to mapOf("worldId" to "$worldId", "analysisId" to "$analysisId",
            "request" to mapOf("key" to "apply-1", "expectedDraftRevision" to 1, "candidates" to listOf(mapOf("candidateId" to "$candidateId", "decisionSequence" to 1)))),
        "world_analysis_application_read" to mapOf("worldId" to "$worldId", "analysisId" to "$analysisId", "applicationId" to "$applicationId"),
    )

    // InitialWorldAnalysisController가 맡은 도구다. 나머지 도구는 WorldStudioController·InitialWorldApplicationController이며 WorldStudioExceptionHandler만 따른다.
    private val analysisTools = setOf("world_analysis_create", "world_analysis_list", "world_analysis_read", "world_analysis_candidates", "world_analysis_decide")

    @Test fun `this class registers the world studio public analysis and application tools and only the lookups are read-only`() {
        assertEquals((userTools.keys + "world_studio_public_list" + "world_studio_public_read").sorted(), specs.map { it.tool().name() }.sorted())
        val readOnly = specs.filter { it.tool().annotations()?.readOnlyHint() == true }.map { it.tool().name() }

        assertEquals(setOf("world_studio_list", "world_studio_read", "world_studio_revisions", "world_studio_revision_read",
            "world_studio_public_list", "world_studio_public_read", "world_analysis_list", "world_analysis_read",
            "world_analysis_candidates", "world_analysis_application_read"), readOnly.toSet())
    }

    @Test fun `no tool takes a member id because the caller comes only from the verified token`() {
        for (spec in specs) {
            val names = (spec.tool().inputSchema()["properties"] as Map<*, *>).keys.map { it.toString().lowercase() }

            assertTrue(names.none { "member" in it || "owner" in it || "principal" in it || "context" in it }, "${spec.tool().name()} $names")
        }
    }

    @Test fun `world_studio_list forwards the caller and adds each linked work id`() {
        `when`(studio.list(member)).thenReturn(listOf(WorldStudioSummaryResponse(worldId, "달빛 세계", "", 1, "current")))
        `when`(links.linkedWorkIds(listOf(worldId))).thenReturn(mapOf(worldId to "w1"))

        val result = call("world_studio_list", emptyMap(), signedIn())

        assertNotEquals(true, result.isError())
        assertTrue(result.text().contains("\"linkedWorkId\":\"w1\""), result.text())
        verify(studio).list(member)
    }

    @Test fun `world_studio_create forwards the caller and the same request DTO and adds the linked work id`() {
        `when`(studio.create(member, CreateWorldRequest("달빛 세계", "설명", worldId))).thenReturn(draft())
        `when`(links.linkedWorkIds(listOf(worldId))).thenReturn(mapOf(worldId to "w1"))

        val result = call("world_studio_create", mapOf("request" to mapOf("name" to "달빛 세계", "description" to "설명", "id" to "$worldId")), signedIn())

        assertNotEquals(true, result.isError())
        assertTrue(result.text().contains("\"linkedWorkId\":\"w1\""), result.text())
        verify(studio).create(member, CreateWorldRequest("달빛 세계", "설명", worldId))
    }

    @Test fun `world_studio_create may omit the id and the request DTO then supplies a fresh one`() {
        val answering = mock(WorldStudioService::class.java, Answer<Any> { draft() })

        val result = call("world_studio_create", mapOf("request" to mapOf("name" to "달빛 세계")), signedIn(), toolsOver(answering, links, publicWorlds, analyses, applications))

        assertNotEquals(true, result.isError(), result.text())
        val sent = mockingDetails(answering).invocations.single { it.method.name == "create" }.arguments[1] as CreateWorldRequest
        assertEquals("달빛 세계", sent.name)
        assertEquals("", sent.description)
    }

    @Test fun `world_studio_read forwards the id and the caller and adds the linked work id`() {
        `when`(studio.draft(worldId, member)).thenReturn(draft())
        `when`(links.linkedWorkIds(listOf(worldId))).thenReturn(mapOf(worldId to "w1"))

        val result = call("world_studio_read", mapOf("id" to "$worldId"), signedIn())

        assertNotEquals(true, result.isError())
        assertTrue(result.text().contains("\"linkedWorkId\":\"w1\""), result.text())
        verify(studio).draft(worldId, member)
    }

    @Test fun `world_studio_read reads the relations as of the optional episode and rejects a malformed one before any service`() {
        `when`(studio.draft(worldId, member, 3)).thenReturn(draft())
        `when`(links.linkedWorkIds(listOf(worldId))).thenReturn(mapOf(worldId to "w1"))

        val result = call("world_studio_read", mapOf("id" to "$worldId", "episode" to "3"), signedIn())

        assertNotEquals(true, result.isError(), result.text())
        verify(studio).draft(worldId, member, 3)
        verifyNoMoreInteractions(studio)
        for (bad in listOf("0", "-1", "abc", "1.5")) {
            val failed = call("world_studio_read", mapOf("id" to "$worldId", "episode" to bad), signedIn())

            assertEquals(true, failed.isError(), bad)
            assertEquals(listOf("HTTP 422 WORLD_INPUT_INVALID", "이름·내용 길이, 카드·관계 ID와 입력 값을 확인하세요."), failed.text().lines(), bad)
        }
        verifyNoMoreInteractions(studio)
    }

    @Test fun `the read and edit tools tell the caller about the optional episode`() {
        fun schema(tool: String) = specs.single { it.tool().name() == tool }.tool().inputSchema().toString()

        assertTrue("episode" in schema("world_studio_read"), schema("world_studio_read"))
        assertTrue("episode" in schema("world_studio_edit_draft"), schema("world_studio_edit_draft"))
    }

    @Test fun `world_studio_edit_draft binds nested cards and relationships and forwards the same request DTO`() {
        val lira = UUID.fromString("77777777-7777-7777-7777-777777777777")
        val moon = UUID.fromString("88888888-8888-8888-8888-888888888888")
        val request = EditWorldDraftRequest(3, "달빛 세계", "설명",
            listOf(CardPayload(lira, "리라", "마법사", "character", "basic", tags = listOf("주인공"), semanticMetadata = mapOf("revealFromEpisode" to 2))),
            listOf(RelationshipPayload(UUID.fromString("99999999-9999-9999-9999-999999999999"), lira, moon, "structural", label = "남매")), "edit-1", true)
        `when`(studio.edit(worldId, member, request)).thenReturn(draft())

        val result = call("world_studio_edit_draft", mapOf("id" to "$worldId", "request" to mapOf(
            "expectedDraftRevision" to 3, "name" to "달빛 세계", "description" to "설명", "key" to "edit-1", "replace" to true,
            "cards" to listOf(mapOf("id" to "$lira", "title" to "리라", "body" to "마법사", "cardType" to "character", "areaCode" to "basic",
                "tags" to listOf("주인공"), "semanticMetadata" to mapOf("revealFromEpisode" to 2))),
            "relationships" to listOf(mapOf("id" to "99999999-9999-9999-9999-999999999999", "sourceCardId" to "$lira", "targetCardId" to "$moon",
                "category" to "structural", "label" to "남매")))), signedIn())

        assertNotEquals(true, result.isError(), result.text())
        verify(studio).edit(worldId, member, request)
    }

    @Test fun `world_studio_save_revision forwards the id the caller and the same request DTO`() {
        val saved = WorldRevisionResponse(worldId, revisionId, 1, "달빛 세계", "설명", null, null, emptyList(), null)
        `when`(studio.save(worldId, member, SaveWorldRequest(1, "save-1"))).thenReturn(saved)

        val result = call("world_studio_save_revision", userTools.getValue("world_studio_save_revision"), signedIn())

        assertNotEquals(true, result.isError())
        assertTrue(result.text().contains("\"revisionNo\":1"), result.text())
        verify(studio).save(worldId, member, SaveWorldRequest(1, "save-1"))
    }

    @Test fun `world_studio_update_publication forwards the id the caller and the same request DTO`() {
        val request = PublicationRequest("public", "fantasy")
        `when`(studio.publication(worldId, member, request)).thenReturn(PublicationResponse(worldId, "public", "fantasy", "2026-11-13T00:00:00Z", true))

        val result = call("world_studio_update_publication", userTools.getValue("world_studio_update_publication"), signedIn())

        assertNotEquals(true, result.isError())
        assertTrue(result.text().contains("\"listed\":true"), result.text())
        verify(studio).publication(worldId, member, request)
    }

    @Test fun `world_studio_revisions and world_studio_revision_read forward the ids and the caller`() {
        `when`(studio.revisionSummaries(worldId, member)).thenReturn(listOf(WorldRevisionSummaryResponse(worldId, revisionId, 1, "달빛 세계", "2026-11-13T00:00:00Z")))
        `when`(studio.revision(worldId, member, revisionId)).thenReturn(WorldRevisionResponse(worldId, revisionId, 1, "달빛 세계", "설명", null, null, emptyList(), null))

        val list = call("world_studio_revisions", userTools.getValue("world_studio_revisions"), signedIn())
        val one = call("world_studio_revision_read", userTools.getValue("world_studio_revision_read"), signedIn())

        assertNotEquals(true, list.isError())
        assertTrue(list.text().contains("\"revisionNo\":1"), list.text())
        assertNotEquals(true, one.isError())
        assertTrue(one.text().contains("\"revisionId\":\"$revisionId\""), one.text())
        verify(studio).revisionSummaries(worldId, member)
        verify(studio).revision(worldId, member, revisionId)
    }

    @Test fun `public world tools need no caller and forward their optional arguments unchanged`() {
        `when`(publicWorlds.list(null, null, null)).thenReturn(PublicWorldPageResponse(emptyList(), 0, 24, 0))
        `when`(publicWorlds.list("fantasy", "1", "10")).thenReturn(PublicWorldPageResponse(emptyList(), 1, 10, 0))
        `when`(publicWorlds.detail(worldId)).thenReturn(
            PublicWorldResponse(worldId, "달빛 세계", "설명", "fantasy", "작가", "2026-11-13T00:00:00Z", 1, emptyList(), emptyList(), "current"))

        val all = call("world_studio_public_list", emptyMap())
        val page = call("world_studio_public_list", mapOf("genre" to "fantasy", "page" to "1", "size" to "10"))
        val one = call("world_studio_public_read", mapOf("id" to "$worldId"))

        assertNotEquals(true, all.isError())
        assertTrue(all.text().contains("\"size\":24"), all.text())
        assertTrue(page.text().contains("\"page\":1"), page.text())
        assertNotEquals(true, one.isError())
        assertTrue(one.text().contains("\"relationshipStatus\":\"current\""), one.text())
        verify(publicWorlds).list(null, null, null)
        verify(publicWorlds).list("fantasy", "1", "10")
        verify(publicWorlds).detail(worldId)
    }

    @Test fun `public world tools turn ContentFailure into the HTTP status and detail`() {
        `when`(publicWorlds.detail(worldId)).thenThrow(ContentFailure(404, "세계관을 찾을 수 없습니다."))
        `when`(publicWorlds.list("nope", null, null)).thenThrow(ContentFailure(422, "genre 값을 확인해 주세요."))

        assertEquals(listOf("HTTP 404", "세계관을 찾을 수 없습니다."), call("world_studio_public_read", mapOf("id" to "$worldId")).text().lines())
        assertEquals(listOf("HTTP 422", "genre 값을 확인해 주세요."), call("world_studio_public_list", mapOf("genre" to "nope")).text().lines())
    }

    @Test fun `world_analysis_create returns the analysis while it runs or completes`() {
        val request = InitialWorldAnalysisRequest("analyze-1", 1)
        for (status in listOf("completed", "running")) {
            `when`(analyses.analyze(worldId, member, request)).thenReturn(InitialWorldAnalysisRead(analysis(status), null))

            val result = call("world_analysis_create", userTools.getValue("world_analysis_create"), signedIn())

            assertNotEquals(true, result.isError(), status)
            assertTrue(result.text().contains("\"executionStatus\":\"$status\""), result.text())
            assertTrue(result.text().contains("\"analysisId\":\"$analysisId\""), result.text())
        }
        verify(analyses, times(2)).analyze(worldId, member, request)
    }

    @Test fun `world_analysis_create reports failed as 502 and unknown as 503 with the stored failure code like the controller`() {
        val request = InitialWorldAnalysisRequest("analyze-1", 1)
        for ((status, http) in mapOf("failed" to 502, "unknown" to 503)) {
            `when`(analyses.analyze(worldId, member, request)).thenReturn(InitialWorldAnalysisRead(analysis(status), "AI_OUTPUT_INVALID"))

            val result = call("world_analysis_create", userTools.getValue("world_analysis_create"), signedIn())

            assertEquals(true, result.isError(), status)
            val lines = result.text().lines()
            assertEquals("HTTP $http AI_OUTPUT_INVALID", lines.first(), status)
            // 본문 DTO 대신 판단에 필요한 사실(상태·분석 ID)을 알려 모델이 world_analysis_read로 이어 갈 수 있게 한다.
            assertTrue(lines.drop(1).joinToString(" ").let { status in it && "$analysisId" in it }, result.text())
        }
    }

    @Test fun `world_analysis_read returns failed and unknown analyses as plain bodies because the controller answers 200`() {
        for (status in listOf("failed", "unknown", "running")) {
            `when`(analyses.get(worldId, member, analysisId)).thenReturn(InitialWorldAnalysisRead(analysis(status), "AI_TIMEOUT"))

            val result = call("world_analysis_read", userTools.getValue("world_analysis_read"), signedIn())

            assertNotEquals(true, result.isError(), status)
            assertTrue(result.text().contains("\"executionStatus\":\"$status\""), result.text())
        }
    }

    @Test fun `world_analysis_list and world_analysis_candidates forward the ids and the caller`() {
        `when`(analyses.list(worldId, member)).thenReturn(listOf(analysis("completed")))
        `when`(analyses.candidates(worldId, member, analysisId)).thenReturn(emptyList())

        val list = call("world_analysis_list", userTools.getValue("world_analysis_list"), signedIn())
        val candidates = call("world_analysis_candidates", userTools.getValue("world_analysis_candidates"), signedIn())

        assertNotEquals(true, list.isError())
        assertTrue(list.text().contains("\"analysisId\":\"$analysisId\""), list.text())
        assertNotEquals(true, candidates.isError())
        assertEquals("[]", candidates.text())
        verify(analyses).list(worldId, member)
        verify(analyses).candidates(worldId, member, analysisId)
    }

    @Test fun `world_analysis_decide binds an edited candidate and forwards the ids the caller and the same request DTO`() {
        val edited = InitialWorldCandidateOutput("c1", "card", "리라", "마법사", null, emptyList(), "source", emptyList(), null, "", "", "neutral")
        val request = InitialWorldDecisionRequest("decide-1", 0, "edit", edited, "문장을 다듬었어요")
        val record = InitialWorldDecisionRecord(candidateId, "c1", 1, "approved", edited)
        `when`(analyses.decide(worldId, member, analysisId, candidateId, request)).thenReturn(record)

        val result = call("world_analysis_decide", mapOf("worldId" to "$worldId", "analysisId" to "$analysisId", "candidateId" to "$candidateId",
            "request" to mapOf("key" to "decide-1", "expectedDecisionSequence" to 0, "action" to "edit", "comment" to "문장을 다듬었어요", "editedCandidate" to mapOf(
                "localRef" to "c1", "type" to "card", "title" to "리라", "text" to "마법사", "subjectId" to null, "relatedEntityIds" to emptyList<String>(),
                "provenance" to "source", "evidence" to emptyList<Any>(), "relation" to null, "condition" to "", "timeText" to "", "polarity" to "neutral"))), signedIn())

        assertNotEquals(true, result.isError(), result.text())
        assertTrue(result.text().contains("\"state\":\"approved\""), result.text())
        verify(analyses).decide(worldId, member, analysisId, candidateId, request)
    }

    @Test fun `world_analysis_decide accepts a null edited candidate`() {
        val request = InitialWorldDecisionRequest("decide-1", 0, "approve", null, "")
        val record = InitialWorldDecisionRecord(candidateId, "c1", 1, "approved",
            InitialWorldCandidateOutput("c1", "card", "리라", "마법사", null, emptyList(), "source", emptyList(), null, "", "", "neutral"))
        `when`(analyses.decide(worldId, member, analysisId, candidateId, request)).thenReturn(record)

        val result = call("world_analysis_decide", userTools.getValue("world_analysis_decide"), signedIn())

        assertNotEquals(true, result.isError(), result.text())
        verify(analyses).decide(worldId, member, analysisId, candidateId, request)
    }

    @Test fun `world_analysis_apply returns the receipt while applying or applied and reports other states as 503 like the controller`() {
        val request = InitialWorldApplicationRequest("apply-1", 1, listOf(InitialWorldSelection(candidateId, 1)))
        for (status in listOf("applied", "applying")) {
            `when`(applications.apply(worldId, member, analysisId, request)).thenReturn(receipt(status))

            val result = call("world_analysis_apply", userTools.getValue("world_analysis_apply"), signedIn())

            assertNotEquals(true, result.isError(), status)
            assertTrue(result.text().contains("\"status\":\"$status\""), result.text())
        }
        for (status in listOf("failed", "unknown")) {
            `when`(applications.apply(worldId, member, analysisId, request)).thenReturn(receipt(status))

            val result = call("world_analysis_apply", userTools.getValue("world_analysis_apply"), signedIn())

            assertEquals(true, result.isError(), status)
            val lines = result.text().lines()
            assertEquals("HTTP 503", lines.first(), status)
            assertTrue(lines.drop(1).joinToString(" ").let { status in it && "$applicationId" in it }, result.text())
        }
    }

    @Test fun `world_analysis_application_read returns the receipt whatever its state because the controller answers 200`() {
        for (status in listOf("applied", "applying", "failed", "unknown")) {
            `when`(applications.get(worldId, member, analysisId, applicationId)).thenReturn(receipt(status))

            val result = call("world_analysis_application_read", userTools.getValue("world_analysis_application_read"), signedIn())

            assertNotEquals(true, result.isError(), status)
            assertTrue(result.text().contains("\"status\":\"$status\""), result.text())
        }
    }

    @Test fun `a user tool without a caller is a 401 tool error and never reaches a service`() {
        for ((tool, args) in userTools) {
            val result = call(tool, args)

            assertEquals(true, result.isError(), tool)
            assertEquals("HTTP 401 AUTHENTICATION_REQUIRED", result.text().lines().first(), tool)
        }
        verifyNoInteractions(studio, links, publicWorlds, analyses, applications)
    }

    @Test fun `a malformed UUID argument is a 400 like the controller's path binding and never reaches a service`() {
        val malformed = mapOf(
            "world_studio_read" to mapOf("id" to "not-a-uuid"),
            "world_studio_public_read" to mapOf("id" to "not-a-uuid"),
            "world_analysis_read" to mapOf("worldId" to "$worldId", "analysisId" to "not-a-uuid"),
            "world_analysis_decide" to userTools.getValue("world_analysis_decide") + mapOf("candidateId" to "not-a-uuid"),
        )
        for ((tool, args) in malformed) {
            val result = call(tool, args, signedIn())

            assertEquals(true, result.isError(), tool)
            assertEquals(listOf("HTTP 400", "요청 형식과 필수 항목을 확인해 주세요."), result.text().lines(), tool)
        }
        verifyNoInteractions(studio, links, publicWorlds, analyses, applications)
    }

    // WorldStudioExceptionHandler가 모든 WorldStudio 계열 Controller에 적용하는 매핑이다(상태·code·detail 모두 같아야 한다).
    private val sharedFailures: List<Pair<Throwable, List<String>>> = listOf(
        WorldNotFound() to listOf("HTTP 404 WORLD_NOT_FOUND", "세계관을 찾을 수 없습니다."),
        WorldConflict() to listOf("HTTP 409 WORLD_CONFLICT", "다른 편집본 또는 저장 요청과 충돌했습니다. 입력을 보존하고 상태를 확인하세요."),
        // 입력 원문이 섞일 수 있는 예외 메시지는 되돌려 주지 않는다.
        IllegalArgumentException("원고 본문 일부") to listOf("HTTP 422 WORLD_INPUT_INVALID", "이름·내용 길이, 카드·관계 ID와 입력 값을 확인하세요."),
        DataAccessResourceFailureException("jdbc 원고 본문 일부") to listOf("HTTP 503 WORLD_WRITE_UNCONFIRMED", "저장 완료를 확인하지 못했습니다. 입력을 보존하고 동일 요청으로 다시 시도하세요."),
        TransactionSystemException("tx 원고 본문 일부") to listOf("HTTP 503 WORLD_WRITE_UNCONFIRMED", "저장 완료를 확인하지 못했습니다. 입력을 보존하고 동일 요청으로 다시 시도하세요."),
        IllegalStateException("원고 본문 일부") to listOf("HTTP 500", "요청을 처리하지 못했어요."),
    ) + Reason.entries.map { reason ->
        val status = mapOf(Reason.MIGRATION to 409, Reason.REJECTED to 409, Reason.MISMATCH to 409, Reason.HISTORY to 409, Reason.INCOMPLETE to 503, Reason.UNAVAILABLE to 503).getValue(reason)
        WorldStudioFailure(reason) to listOf("HTTP $status ${reason.code}", reason.detail)
    } + (ContentFailure(404, "작품을 찾을 수 없어요.") to listOf("HTTP 404", "작품을 찾을 수 없어요."))

    // 모든 Service 호출이 같은 예외를 던지게 해 도구마다 예외 → 도구 오류 변환이 적용되는지 본다.
    private fun everyToolFailsWith(error: Throwable): Map<String, List<String>> {
        val boom = Answer<Any> { throw error }
        val failing = toolsOver(mock(WorldStudioService::class.java, boom), mock(WorkWorldService::class.java, boom), mock(PublicWorldService::class.java, boom),
            mock(InitialWorldAnalysisService::class.java, boom), mock(InitialWorldApplicationService::class.java, boom))
        return userTools.mapValues { (tool, args) -> call(tool, args, signedIn(), failing).also { assertEquals(true, it.isError(), tool) }.text().lines() }
    }

    @Test fun `every owner tool turns the shared WorldStudio failures into the same status code and detail as the HTTP API`() {
        for ((error, lines) in sharedFailures) {
            for ((tool, actual) in everyToolFailsWith(error)) assertEquals(lines, actual, "$tool ${error.javaClass.simpleName}")
        }
    }

    @Test fun `review conflicts read as the controller words them`() {
        val stale = listOf("HTTP 409 ANALYSIS_STALE", "원본이 변경되었습니다. 재분석 후 검토하세요.")
        val notCompleted = InitialWorldReviewConflict("ANALYSIS_NOT_COMPLETED")
        for ((tool, actual) in everyToolFailsWith(InitialWorldReviewConflict("ANALYSIS_STALE"))) assertEquals(stale, actual, tool)
        for ((tool, actual) in everyToolFailsWith(notCompleted)) {
            // 분석 Controller는 자기 핸들러로 '검토'라 하고, 그 밖의 Controller는 공통 핸들러의 '처리'를 쓴다.
            val verb = if (tool in analysisTools) "검토" else "처리"
            assertEquals(listOf("HTTP 409 ANALYSIS_NOT_COMPLETED", "완료된 분석 후보만 ${verb}할 수 있습니다."), actual, tool)
        }
    }

    @Test fun `analysis tools report unconfirmed analysis storage as 503 and other tools do not know that failure`() {
        val unconfirmed = AnalysisStorageUnconfirmed(worldId, analysisId)

        for ((tool, actual) in everyToolFailsWith(unconfirmed)) {
            val expected = if (tool in analysisTools) listOf("HTTP 503 ANALYSIS_STORAGE_UNCONFIRMED", "저장 결과를 확인하지 못했습니다. 동일 키로 조회하고 새 키로 자동 실행하지 마세요.")
            else listOf("HTTP 500", "요청을 처리하지 못했어요.")
            assertEquals(expected, actual, tool)
        }
    }
}
