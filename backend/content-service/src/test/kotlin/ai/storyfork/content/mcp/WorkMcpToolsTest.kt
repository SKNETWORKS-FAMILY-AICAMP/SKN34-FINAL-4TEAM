package ai.storyfork.content.mcp

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.config.OPERATOR_AUTHORITY
import ai.storyfork.content.context.service.ContextService
import ai.storyfork.content.context.service.dto.ContextRequest
import ai.storyfork.content.fork.service.ForkService
import ai.storyfork.content.fork.service.dto.ChangeRequest
import ai.storyfork.content.fork.service.dto.ForkRequest
import ai.storyfork.content.notice.service.WorkNoticeService
import ai.storyfork.content.notice.service.dto.WorkNoticeRequest
import ai.storyfork.content.notice.service.dto.WorkNoticeResponse
import ai.storyfork.content.plan.service.StoryPlanService
import ai.storyfork.content.proposal.service.ProposalService
import ai.storyfork.content.proposal.service.dto.ProposalRequest
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import ai.storyfork.content.work.service.dto.PolicyRequest
import ai.storyfork.content.work.service.dto.UpdateWorkRequest
import ai.storyfork.content.work.service.dto.WorkListResponse
import ai.storyfork.content.work.service.dto.WorkResponse
import ai.storyfork.content.work.service.dto.WorkWorldLinkResponse
import io.modelcontextprotocol.common.McpTransportContext
import io.modelcontextprotocol.spec.McpSchema.CallToolRequest
import io.modelcontextprotocol.spec.McpSchema.CallToolResult
import io.modelcontextprotocol.spec.McpSchema.TextContent
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import org.mockito.Mockito.*
import org.mockito.stubbing.Answer
import org.springframework.ai.mcp.annotation.McpTool
import org.springframework.ai.mcp.annotation.spring.SyncMcpAnnotationProviders
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder

private const val ME = "member-1"
private const val WORK = "work-1"
private const val NOTICE = "notice-1"
private const val PROPOSAL = "proposal-1"
private val WORLD: UUID = UUID.fromString("0f8c9a52-5b1e-4d0a-9d55-7a2d3c4b5e6f")

/**
 * 작품 도구(`work_*`)가 기존 Service 함수의 어댑터일 뿐임을 확인한다. Spring context 없이 실제 `@McpTool` 호출 경로를 지난다.
 * 인자 값은 도구마다 서로 다른 문자열을 써서 Service 인자 순서를 바꿔 넘기는 실수도 잡는다.
 */
class WorkMcpToolsTest {
    private val service = mock(WorkService::class.java)
    private val worldLinks = mock(WorkWorldService::class.java)
    private val notices = mock(WorkNoticeService::class.java)
    private val forks = mock(ForkService::class.java)
    private val contexts = mock(ContextService::class.java)
    private val proposals = mock(ProposalService::class.java)
    private val specs = SyncMcpAnnotationProviders.statelessToolSpecifications(
        listOf<Any>(WorkMcpTools(service, worldLinks, notices, forks, contexts, proposals)))

    private fun resetServices() = reset(service, worldLinks, notices, forks, contexts, proposals)

    private fun call(tool: String, args: Map<String, Any?> = emptyMap(), context: McpTransportContext = McpTransportContext.EMPTY): CallToolResult =
        specs.single { it.tool().name() == tool }.callHandler().apply(context, CallToolRequest.builder(tool).arguments(args).build())

    private fun CallToolResult.text() = (content().single() as TextContent).text()

    /** 기존 `ContentAuthenticationFilter`가 만드는 인증과 같은 모양으로 호출자를 싣는다(Principal 이름은 회원 UUID, 운영자는 ROLE_OPERATOR). */
    private fun signedIn(operator: Boolean = false): McpTransportContext {
        SecurityContextHolder.getContext().authentication =
            UsernamePasswordAuthenticationToken.authenticated(ME, null, if (operator) listOf(SimpleGrantedAuthority(OPERATOR_AUTHORITY)) else emptyList())
        try {
            return mcpCallerContext()
        } finally {
            SecurityContextHolder.clearContext()
        }
    }

    private fun work(id: String) = WorkResponse(id, "제목 $id", "소개", "public", true, true, null, emptyList(), null)

    // ---- work_public_list (공통 기반의 기준 도구) ----

    @Test fun `work_public_list is a read-only public tool whose search arguments are all optional`() {
        val tool = specs.single { it.tool().name() == "work_public_list" }.tool()
        val schema = tool.inputSchema()

        assertEquals(setOf("q", "f", "sort", "page", "size"), (schema["properties"] as Map<*, *>).keys)
        assertEquals(emptyList<String>(), schema["required"])
        assertEquals(true, tool.annotations().readOnlyHint())
    }

    @Test fun `it forwards its arguments to WorkService publicList unchanged and returns the same list`() {
        `when`(service.publicList("달빛", "tag", "view", "0", "10")).thenReturn(WorkListResponse(listOf(work("w1"))))

        val result = call("work_public_list", mapOf("q" to "달빛", "f" to "tag", "sort" to "view", "page" to "0", "size" to "10"))

        assertNotEquals(true, result.isError())
        assertTrue(result.text().contains("\"id\":\"w1\""), result.text())
        assertTrue(result.text().contains("\"title\":\"제목 w1\""), result.text())
        verify(service).publicList("달빛", "tag", "view", "0", "10")
    }

    @Test fun `omitted arguments are passed as null so the service applies its own defaults`() {
        `when`(service.publicList(null, null, null, null, null)).thenReturn(WorkListResponse(emptyList()))

        val result = call("work_public_list")

        assertNotEquals(true, result.isError())
        assertEquals("[]", result.text())
        verify(service).publicList(null, null, null, null, null)
    }

    @Test fun `a service failure is a tool error with the HTTP status and detail`() {
        `when`(service.publicList(null, "bad", null, null, null)).thenThrow(ContentFailure(422, "검색 범위를 확인해 주세요."))

        val result = call("work_public_list", mapOf("f" to "bad"))

        assertEquals(true, result.isError())
        assertEquals(listOf("HTTP 422", "검색 범위를 확인해 주세요."), result.text().lines())
    }

    // ---- 모든 도구: 같은 Service 함수에 인자·회원이 그대로 닿는다 ----

    /** 도구 하나의 호출 입력과, 그 호출이 Service 함수에 그대로 닿았는지 보는 검증이다. [public]이면 호출자 없이 부른다. */
    private inner class Case(val tool: String, val args: Map<String, Any?>, val public: Boolean = false, val label: String = tool, val reaches: () -> Unit)

    private fun cases(): List<Case> = listOf(
        Case("work_list_mine", emptyMap()) { verify(service).list(ME) },
        Case("work_create", mapOf("data" to mapOf("title" to "달빛 서점", "summary" to "소개", "genres" to listOf("판타지"), "hashtags" to listOf("달빛"), "creationType" to "original", "rightsConfirmed" to true))) {
            verify(service).create(ME, CreateWorkRequest("달빛 서점", "소개", "original", listOf("판타지"), listOf("달빛"), true))
        },
        Case("work_read", mapOf("id" to WORK)) { verify(service).read(WORK, ME) },
        Case("work_update", mapOf("id" to WORK, "data" to mapOf("title" to "새 제목", "summary" to "새 소개", "revision" to 3, "genres" to listOf("로맨스")))) {
            verify(service).update(WORK, ME, UpdateWorkRequest("새 제목", "새 소개", 3, listOf("로맨스"), null))
        },
        Case("work_delete", mapOf("id" to WORK)) { verify(service).delete(WORK, ME) },
        Case("work_stop_fork_publication", mapOf("id" to WORK)) { verify(service).stopForkPublication(WORK, ME) },
        Case("work_history", mapOf("id" to WORK)) { verify(service).history(WORK, ME) },
        Case("work_update_policy", mapOf("id" to WORK, "data" to mapOf("revision" to 2, "allowFork" to true, "allowForkPublication" to false, "episodeScope" to "from", "fromEpisode" to 2))) {
            verify(service).policy(WORK, ME, PolicyRequest(2, true, false, "from", 2))
        },
        Case("work_public_ranking", mapOf("kind" to "top"), public = true) { verify(service).ranking("top") },
        Case("work_public_rankings", mapOf("kind" to "view", "period" to "week", "type" to "fork", "limit" to "5"), public = true) {
            verify(service).rankings("view", "week", "fork", "5")
        },
        Case("work_public_rankings", mapOf("kind" to "popular"), public = true, label = "work_public_rankings kind only") {
            verify(service).rankings("popular", null, null, null)
        },
        Case("work_link_world_studio", mapOf("id" to WORK, "worldId" to WORLD.toString())) { verify(worldLinks).link(WORK, ME, WORLD) },
        Case("work_link_world_studio", mapOf("id" to WORK), label = "work_link_world_studio omitted world id unlinks") { verify(worldLinks).link(WORK, ME, null) },
        Case("work_public_world_cards", mapOf("id" to WORK, "upto" to "3"), public = true) { verify(worldLinks).readerCards(WORK, "3") },
        Case("work_public_world_cards", mapOf("id" to WORK), public = true, label = "work_public_world_cards omitted upto") { verify(worldLinks).readerCards(WORK, null) },
        Case("work_notice_public_list", mapOf("id" to WORK), public = true) { verify(notices).list(WORK) },
        Case("work_notice_create", mapOf("id" to WORK, "data" to mapOf("category" to "info", "title" to "휴재 안내", "body" to "이번 주는 쉽니다", "pinned" to true))) {
            verify(notices).create(WORK, ME, false, WorkNoticeRequest("info", "휴재 안내", "이번 주는 쉽니다", true))
        },
        Case("work_notice_update", mapOf("id" to WORK, "noticeId" to NOTICE, "data" to mapOf("category" to "event", "title" to "이벤트", "body" to "내용"))) {
            verify(notices).update(WORK, NOTICE, ME, false, WorkNoticeRequest("event", "이벤트", "내용"))
        },
        Case("work_notice_delete", mapOf("id" to WORK, "noticeId" to NOTICE)) { verify(notices).delete(WORK, NOTICE, ME, false) },
        Case("work_fork_create", mapOf("id" to WORK, "data" to mapOf("episode" to 2, "title" to "다른 결말", "summary" to "소개", "direction" to "방향"))) {
            verify(forks).create(WORK, ME, ForkRequest(2, "다른 결말", "소개", "방향"))
        },
        Case("work_fork_world_change", mapOf("id" to WORK, "data" to mapOf("revision" to 1, "changeId" to "change-1", "decision" to "apply"))) {
            verify(forks).decideChange(WORK, ME, ChangeRequest(1, "change-1", "apply"))
        },
        Case("work_context_read", mapOf("id" to WORK, "episode" to 2, "query" to "질의", "character" to "인물")) {
            verify(contexts).read(WORK, ME, ContextRequest(2, "질의", "인물"))
        },
        Case("work_context_read", mapOf("id" to WORK, "episode" to 2), label = "work_context_read omitted query and character") {
            verify(contexts).read(WORK, ME, ContextRequest(2, "", ""))
        },
        Case("work_context_public_read", mapOf("id" to WORK, "episode" to 2, "query" to "질의", "character" to "인물"), public = true) {
            verify(contexts).read(WORK, null, ContextRequest(2, "질의", "인물"))
        },
        Case("work_proposal_create", mapOf("id" to WORK, "data" to mapOf("revision" to 4, "prompt" to "다음 장면", "consent" to true, "episode" to 3, "character" to "인물"))) {
            verify(proposals).propose(WORK, ME, ProposalRequest(4, "다음 장면", true, 3, "인물"))
        },
        Case("work_proposal_accept", mapOf("id" to WORK, "proposalId" to PROPOSAL, "data" to mapOf("revision" to 4))) {
            verify(proposals).accept(WORK, PROPOSAL, ME, 4)
        },
    )

    @TestFactory fun `each tool passes its arguments and the verified member to the same service function`(): List<DynamicTest> =
        cases().map { case ->
            dynamicTest("${case.label} forwards to the service") {
                resetServices()

                val result = call(case.tool, case.args, if (case.public) McpTransportContext.EMPTY else signedIn())

                assertNotEquals(true, result.isError(), "${case.label}: ${result.content()}")
                case.reaches()
            }
        }

    @TestFactory fun `a user tool without a caller is a 401 tool error and never reaches a service`(): List<DynamicTest> =
        cases().filterNot { it.public }.map { case ->
            dynamicTest("${case.label} needs a caller") {
                resetServices()

                val result = call(case.tool, case.args)

                assertEquals(true, result.isError(), case.label)
                assertEquals("HTTP 401 AUTHENTICATION_REQUIRED", result.text().lines().first(), case.label)
                verifyNoInteractions(service, worldLinks, notices, forks, contexts, proposals)
            }
        }

    // 컨트롤러의 `@Valid @RequestBody`·`@Valid @ModelAttribute`와 같은 제약을 도구도 지킨다(Service는 호출하지 않는다).
    private class Violation(val tool: String, val args: Map<String, Any?>, val fields: String, val public: Boolean = false)

    private val violations = listOf(
        Violation("work_create", mapOf("data" to mapOf("title" to "")), "title"),
        Violation("work_update", mapOf("id" to WORK, "data" to mapOf("title" to "", "revision" to 0)), "title"),
        Violation("work_update_policy", mapOf("id" to WORK, "data" to mapOf("revision" to -1, "allowFork" to true, "allowForkPublication" to true)), "revision"),
        Violation("work_fork_create", mapOf("id" to WORK, "data" to mapOf("episode" to 0, "title" to "제목")), "episode"),
        Violation("work_fork_world_change", mapOf("id" to WORK, "data" to mapOf("revision" to 0, "changeId" to "change-1", "decision" to "maybe")), "decision"),
        Violation("work_context_read", mapOf("id" to WORK, "episode" to 0), "episode"),
        Violation("work_context_public_read", mapOf("id" to WORK, "episode" to 0), "episode", public = true),
        Violation("work_proposal_create", mapOf("id" to WORK, "data" to mapOf("revision" to 0, "prompt" to "", "consent" to true)), "prompt"),
        Violation("work_proposal_accept", mapOf("id" to WORK, "proposalId" to PROPOSAL, "data" to mapOf("revision" to -1)), "revision"),
    )

    @TestFactory fun `input that the controller rejects with Valid is a 422 tool error that names only the fields`(): List<DynamicTest> =
        violations.map { violation ->
            dynamicTest("${violation.tool} validates its input") {
                resetServices()

                val result = call(violation.tool, violation.args, if (violation.public) McpTransportContext.EMPTY else signedIn())

                assertEquals(true, result.isError(), violation.tool)
                assertEquals(listOf("HTTP 422", "입력 길이·회차·필수 항목을 확인해 주세요: ${violation.fields}"), result.text().lines(), violation.tool)
                verifyNoInteractions(service, worldLinks, notices, forks, contexts, proposals)
            }
        }

    // `mcpTool {}`를 빠뜨린 도구는 상태·코드가 빠진 채 나가므로, 모든 Service 호출이 던지는 대역으로 모든 도구를 확인한다.
    @TestFactory fun `every tool reports a service failure with the status code and detail of the existing API`(): List<DynamicTest> {
        val fail = Answer<Any> { throw ContentFailure(409, "다른 변경과 충돌했어요.", "SOME_CODE") }
        val failing = SyncMcpAnnotationProviders.statelessToolSpecifications(listOf<Any>(WorkMcpTools(
            mock(WorkService::class.java, fail), mock(WorkWorldService::class.java, fail), mock(WorkNoticeService::class.java, fail),
            mock(ForkService::class.java, fail), mock(ContextService::class.java, fail), mock(ProposalService::class.java, fail))))
        return cases().map { case ->
            dynamicTest("${case.label} reports the failure") {
                val request = CallToolRequest.builder(case.tool).arguments(case.args).build()

                val result = failing.single { it.tool().name() == case.tool }.callHandler().apply(if (case.public) McpTransportContext.EMPTY else signedIn(), request)

                assertEquals(true, result.isError(), case.label)
                assertEquals(listOf("HTTP 409 SOME_CODE", "다른 변경과 충돌했어요."), result.text().lines(), case.label)
            }
        }
    }

    // ---- 도구별 고유 동작 ----

    @Test fun `work_public_read fills the like state for a verified member and not for an anonymous caller`() {
        `when`(service.publicRead(WORK, null)).thenReturn(work(WORK))
        `when`(service.publicRead(WORK, ME)).thenReturn(work(WORK).copy(liked = true))

        val anonymous = call("work_public_read", mapOf("id" to WORK))
        val member = call("work_public_read", mapOf("id" to WORK), signedIn())

        assertTrue(anonymous.text().contains("\"liked\":false"), anonymous.text())
        assertTrue(member.text().contains("\"liked\":true"), member.text())
    }

    @Test fun `work_link_world_studio returns the link and a malformed world id is a 400 that is not echoed`() {
        `when`(worldLinks.link(WORK, ME, WORLD)).thenReturn(WorkWorldLinkResponse(WORK, WORLD))

        val linked = call("work_link_world_studio", mapOf("id" to WORK, "worldId" to WORLD.toString()), signedIn())
        val malformed = call("work_link_world_studio", mapOf("id" to WORK, "worldId" to "세계관-아님"), signedIn())

        assertTrue(linked.text().contains("\"worldId\":\"$WORLD\""), linked.text())
        assertEquals(true, malformed.isError())
        // 컨트롤러가 읽지 못한 본문에 내리는 400과 같은 문장이며 입력 값은 되돌려 주지 않는다.
        assertEquals(listOf("HTTP 400", "요청 형식과 필수 항목을 확인해 주세요."), malformed.text().lines())
        verify(worldLinks, never()).link(WORK, ME, null)
    }

    @Test fun `notice tools pass the operator flag of the verified caller`() {
        val body = mapOf("category" to "info", "title" to "제목", "body" to "본문")
        for (operator in listOf(true, false)) {
            resetServices()

            call("work_notice_create", mapOf("id" to WORK, "data" to body), signedIn(operator))
            call("work_notice_update", mapOf("id" to WORK, "noticeId" to NOTICE, "data" to body), signedIn(operator))
            call("work_notice_delete", mapOf("id" to WORK, "noticeId" to NOTICE), signedIn(operator))

            verify(notices).create(WORK, ME, operator, WorkNoticeRequest("info", "제목", "본문"))
            verify(notices).update(WORK, NOTICE, ME, operator, WorkNoticeRequest("info", "제목", "본문"))
            verify(notices).delete(WORK, NOTICE, ME, operator)
        }
    }

    @Test fun `work_notice_create returns the notice body only without any HTTP wrapping`() {
        val at = Instant.parse("2026-11-13T00:00:00Z")
        `when`(notices.create(WORK, ME, false, WorkNoticeRequest("info", "제목", "본문"))).thenReturn(WorkNoticeResponse(NOTICE, WORK, "info", "제목", "본문", false, at, at))

        val result = call("work_notice_create", mapOf("id" to WORK, "data" to mapOf("category" to "info", "title" to "제목", "body" to "본문")), signedIn())

        assertNotEquals(true, result.isError())
        assertTrue(result.text().startsWith("{\"id\":\"$NOTICE\""), result.text())
        assertTrue(result.text().contains("\"createdAt\":\"2026-11-13T00:00:00Z\""), result.text())
    }

    @Test fun `the context tools require the basis episode and treat query and character as optional`() {
        for (name in listOf("work_context_read", "work_context_public_read")) {
            val schema = specs.single { it.tool().name() == name }.tool().inputSchema()

            assertEquals(setOf("id", "episode", "query", "character"), (schema["properties"] as Map<*, *>).keys, name)
            assertEquals(listOf("id", "episode"), schema["required"], name)
        }
    }

    // ---- 등록: 계약 '### 작품' 표의 도구가 빠짐없이 이름 그대로 등록된다 ----

    // docs/design/content-mcp-contract.md '### 작품' 표(WorkMcpTools 24 + StoryPlanMcpTools 5)다.
    private val contractTools = listOf(
        "work_list_mine", "work_create", "work_read", "work_update", "work_delete", "work_stop_fork_publication", "work_history", "work_update_policy",
        "work_public_list", "work_public_ranking", "work_public_rankings", "work_public_read", "work_link_world_studio", "work_public_world_cards",
        "work_notice_public_list", "work_notice_create", "work_notice_update", "work_notice_delete", "work_fork_create", "work_fork_world_change",
        "work_context_read", "work_context_public_read", "work_proposal_create", "work_proposal_accept",
        "story_plan_list", "story_plan_read", "story_plan_create", "story_plan_update", "story_plan_delete",
    )

    private val registry = SyncMcpAnnotationProviders.statelessToolSpecifications(
        listOf<Any>(WorkMcpTools(service, worldLinks, notices, forks, contexts, proposals), StoryPlanMcpTools(mock(StoryPlanService::class.java))))

    @Test fun `the work tool classes declare exactly the work tools of the contract and Spring AI registers each of them`() {
        val declared = listOf(WorkMcpTools::class.java, StoryPlanMcpTools::class.java)
            .flatMap { it.declaredMethods.toList() }.mapNotNull { it.getAnnotation(McpTool::class.java)?.name }

        // 정렬한 목록끼리 비교해 빠진 도구뿐 아니라 이름이 겹친 도구도 잡는다.
        assertEquals(contractTools.sorted(), declared.sorted())
        assertEquals(contractTools.sorted(), registry.map { it.tool().name() }.sorted())
    }

    @Test fun `only query tools carry the read-only hint`() {
        val readOnly = registry.filter { it.tool().annotations()?.readOnlyHint() == true }.map { it.tool().name() }.toSet()

        assertEquals(
            setOf(
                "work_list_mine", "work_read", "work_history", "work_public_list", "work_public_ranking", "work_public_rankings", "work_public_read",
                "work_public_world_cards", "work_notice_public_list", "work_context_read", "work_context_public_read", "story_plan_list", "story_plan_read",
            ),
            readOnly,
        )
    }

    @Test fun `every tool and every argument is described for the model`() {
        for (spec in registry) {
            val tool = spec.tool()
            assertFalse(tool.description().isNullOrBlank(), tool.name())
            for ((name, schema) in tool.inputSchema()["properties"] as Map<*, *>) {
                assertFalse(((schema as Map<*, *>)["description"] as String?).isNullOrBlank(), "${tool.name()}.$name")
            }
        }
    }
}
