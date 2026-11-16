package ai.storyfork.content.mcp

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.EpisodeWorldBasisService
import ai.storyfork.content.episode.service.dto.CreateEpisodeRequest
import ai.storyfork.content.episode.service.dto.DraftRequest
import ai.storyfork.content.episode.service.dto.DraftResponse
import ai.storyfork.content.episode.service.dto.EpisodeListResponse
import ai.storyfork.content.episode.service.dto.EpisodeOrderScopeResponse
import ai.storyfork.content.episode.service.dto.EpisodeResponse
import ai.storyfork.content.episode.service.dto.EpisodeWorldBasisRequest
import ai.storyfork.content.episode.service.dto.EpisodeWorldBasisResponse
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.episode_version.service.dto.RevertRequest
import ai.storyfork.content.episode_version.service.dto.SavedEpisodeVersionResult
import ai.storyfork.content.episode_version.service.dto.VersionResponse
import ai.storyfork.content.publication.service.PublicationScheduleService
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublicationScheduleRequest
import ai.storyfork.content.publication.service.dto.PublicationScheduleResponse
import ai.storyfork.content.publication.service.dto.PublicationVisibilityRequest
import ai.storyfork.content.publication.service.dto.PublishRequest
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.WorkResponse
import io.modelcontextprotocol.common.McpTransportContext
import io.modelcontextprotocol.server.McpStatelessServerFeatures.SyncToolSpecification
import io.modelcontextprotocol.spec.McpSchema.CallToolRequest
import io.modelcontextprotocol.spec.McpSchema.CallToolResult
import io.modelcontextprotocol.spec.McpSchema.TextContent
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource
import org.mockito.Mockito.*
import org.mockito.stubbing.Answer
import org.springframework.ai.mcp.annotation.McpTool
import org.springframework.ai.mcp.annotation.spring.SyncMcpAnnotationProviders
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder

/**
 * 계약 '회차' 표의 도구 19개가 기존 Service 함수의 어댑터일 뿐임을 확인한다.
 * Spring context 없이 실제 `@McpTool` 호출 경로(인자 바인딩·스키마·오류 변환)를 지나며 Service는 대역이다.
 */
class EpisodeMcpToolsTest {
    private val episodes = mock(EpisodeService::class.java)
    private val worldBasis = mock(EpisodeWorldBasisService::class.java)
    private val versions = mock(EpisodeVersionService::class.java)
    private val publication = mock(PublicationService::class.java)
    private val schedules = mock(PublicationScheduleService::class.java)
    private val works = mock(WorkService::class.java)
    private val specs = specsOf(EpisodeMcpTools(episodes, worldBasis, versions, publication, schedules, works))

    @AfterEach fun clear() = SecurityContextHolder.clearContext()

    private fun specsOf(tools: EpisodeMcpTools): List<SyncToolSpecification> =
        SyncMcpAnnotationProviders.statelessToolSpecifications(listOf<Any>(tools))

    /** 기본은 로그인한 회원이다. 인증이 없는 호출은 `McpTransportContext.EMPTY`를 넘긴다. */
    private fun signedIn(): McpTransportContext {
        SecurityContextHolder.getContext().authentication = UsernamePasswordAuthenticationToken.authenticated(member, null, emptyList())
        return mcpCallerContext()
    }

    private fun call(tool: String, args: Map<String, Any?>, context: McpTransportContext = signedIn(), on: List<SyncToolSpecification> = specs): CallToolResult =
        on.single { it.tool().name() == tool }.callHandler().apply(context, CallToolRequest.builder(tool).arguments(args).build())

    private fun CallToolResult.text() = (content().single() as TextContent).text()

    private fun ok(tool: String, args: Map<String, Any?>): String {
        val result = call(tool, args)
        assertNotEquals(true, result.isError(), result.text())
        return result.text()
    }

    private fun episode(number: Int) = EpisodeResponse(number, DraftResponse("제목 $number", "본문", 3), emptyList(), null, false, null)

    private fun work(id: String) = WorkResponse(id, "제목 $id", "소개", "public", true, true, null, emptyList(), null)

    private fun schedule(id: String) = PublicationScheduleResponse(id, "v-1", "2030-01-02T03:04:05Z", "pending", 0, null, null)

    // ---- 등록·스키마 ----

    @Test fun `the class registers exactly the 19 episode tools of the contract table`() {
        val declared = EpisodeMcpTools::class.java.declaredMethods.mapNotNull { it.getAnnotation(McpTool::class.java)?.name }

        assertEquals(19, declared.size, "duplicate tool names: $declared")
        assertEquals(contractTools, declared.toSet())
        assertEquals(contractTools, specs.map { it.tool().name() }.toSet())
        assertEquals(contractTools, validArgs.keys)
    }

    @Test fun `tool arguments are exactly the path and body values, never a member id, and every one is described`() {
        for ((tool, args) in validArgs) {
            val definition = specs.single { it.tool().name() == tool }.tool()
            val properties = definition.inputSchema()["properties"] as Map<*, *>

            assertEquals(args.keys, properties.keys, tool)
            assertEquals(args.keys, (definition.inputSchema()["required"] as List<*>).toSet(), tool)
            assertTrue(definition.description().isNotBlank(), tool)
            properties.forEach { (name, schema) ->
                assertTrue(((schema as Map<*, *>)["description"] as? String).orEmpty().isNotBlank(), "$tool.$name has no description")
            }
        }
    }

    @Test fun `only the lookups are read-only tools`() {
        val readOnly = specs.filter { it.tool().annotations()?.readOnlyHint() == true }.map { it.tool().name() }.toSet()

        assertEquals(setOf("episode_list", "episode_read", "episode_order_scope", "episode_world_basis_read", "episode_schedule_list"), readOnly)
    }

    // ---- 모든 도구 공통: 인증·검증·오류 ----

    @ParameterizedTest @MethodSource("toolNames")
    fun `without a caller every tool is a 401 tool error and never reaches a service`(tool: String) {
        val result = call(tool, validArgs.getValue(tool), McpTransportContext.EMPTY)

        assertEquals(true, result.isError(), tool)
        assertEquals("HTTP 401 AUTHENTICATION_REQUIRED", result.text().lines().first(), tool)
        verifyNoInteractions(episodes, worldBasis, versions, publication, schedules, works)
    }

    @ParameterizedTest @MethodSource("toolNames")
    fun `a service failure becomes a tool error with the HTTP status and detail`(tool: String) {
        val boom = Answer<Any?> { throw ContentFailure(404, "회차를 찾을 수 없어요.") }
        val failing = EpisodeMcpTools(
            mock(EpisodeService::class.java, boom), mock(EpisodeWorldBasisService::class.java, boom), mock(EpisodeVersionService::class.java, boom),
            mock(PublicationService::class.java, boom), mock(PublicationScheduleService::class.java, boom), mock(WorkService::class.java, boom),
        )

        val result = call(tool, validArgs.getValue(tool), on = specsOf(failing))

        assertEquals(true, result.isError(), tool)
        assertEquals(listOf("HTTP 404", "회차를 찾을 수 없어요."), result.text().lines(), tool)
    }

    // 컨트롤러의 `@Valid @RequestBody`와 `@RequestParam @Min(0)`은 MCP 인자에 걸리지 않으므로 도구가 같은 422로 막는다.
    @ParameterizedTest @MethodSource("invalidInputs")
    fun `input the controller rejects as 422 is rejected by the tool before any service call`(tool: String, args: Map<String, Any?>, field: String) {
        val result = call(tool, args)

        assertEquals(true, result.isError(), tool)
        assertEquals(listOf("HTTP 422", "입력 길이·회차·필수 항목을 확인해 주세요: $field"), result.text().lines(), tool)
        verifyNoInteractions(episodes, worldBasis, versions, publication, schedules, works)
    }

    @Test fun `every tool that takes a body has an invalid-input case`() {
        val withBody = specs.filter { "data" in (it.tool().inputSchema()["properties"] as Map<*, *>) }.map { it.tool().name() }.toSet()
        val covered = invalidInputs().map { it.get()[0] as String }.toSet()

        assertEquals(withBody + "episode_schedule_cancel", covered)
    }

    // ---- 도구별: 같은 Service 함수에 인자·회원이 그대로 전달되고 응답 DTO가 그대로 돌아온다 ----

    @Test fun `episode_list forwards the work and the caller`() {
        `when`(episodes.list("w1", member)).thenReturn(EpisodeListResponse(listOf(episode(1), episode(2))))

        val text = ok("episode_list", mapOf("id" to "w1"))

        assertTrue(text.startsWith("[") && text.contains("\"title\":\"제목 1\"") && text.contains("\"title\":\"제목 2\""), text)
        verify(episodes).list("w1", member)
    }

    @Test fun `episode_create forwards the title request`() {
        `when`(episodes.create("w1", member, CreateEpisodeRequest("새 회차"))).thenReturn(episode(3))

        val text = ok("episode_create", mapOf("id" to "w1", "data" to mapOf("title" to "새 회차")))

        assertTrue(text.contains("\"title\":\"제목 3\""), text)
        verify(episodes).create("w1", member, CreateEpisodeRequest("새 회차"))
    }

    @Test fun `episode_read forwards the episode number`() {
        `when`(episodes.read("w1", member, 2)).thenReturn(episode(2))

        val text = ok("episode_read", mapOf("id" to "w1", "number" to 2))

        assertTrue(text.contains("\"title\":\"제목 2\""), text)
        verify(episodes).read("w1", member, 2)
    }

    @Test fun `episode_update_draft forwards the draft request and defaults an omitted author note`() {
        `when`(episodes.update("w1", member, 2, DraftRequest("제목", "본문", 3, "작가의 말"))).thenReturn(episode(2))
        `when`(episodes.update("w1", member, 4, DraftRequest("제목", "본문", 3))).thenReturn(episode(4))

        assertTrue(ok("episode_update_draft", mapOf("id" to "w1", "number" to 2, "data" to draftJson)).contains("\"title\":\"제목 2\""))
        assertTrue(ok("episode_update_draft", mapOf("id" to "w1", "number" to 4, "data" to draftJson - "authorNote")).contains("\"title\":\"제목 4\""))
        verify(episodes).update("w1", member, 2, DraftRequest("제목", "본문", 3, "작가의 말"))
        verify(episodes).update("w1", member, 4, DraftRequest("제목", "본문", 3))
    }

    @Test fun `episode_order_scope forwards the episode number`() {
        `when`(episodes.orderScope("w1", member, 2)).thenReturn(EpisodeOrderScopeResponse(2, listOf(1, 3), listOf("제한 사유")))

        val text = ok("episode_order_scope", mapOf("id" to "w1", "number" to 2))

        assertTrue(text.contains("\"candidateNumbers\":[1,3]") && text.contains("제한 사유"), text)
        verify(episodes).orderScope("w1", member, 2)
    }

    @Test fun `episode_delete_draft forwards the revision and reports completion`() {
        val text = ok("episode_delete_draft", mapOf("id" to "w1", "number" to 2, "revision" to 5))

        assertEquals("\"Done\"", text)
        verify(episodes).deleteDraft("w1", member, 2, 5)
    }

    @Test fun `episode_delete forwards the revision and reports completion`() {
        val text = ok("episode_delete", mapOf("id" to "w1", "number" to 2, "revision" to 5))

        assertEquals("\"Done\"", text)
        verify(episodes).deleteEpisode("w1", member, 2, 5)
    }

    @Test fun `episode_world_basis_read passes the caller as a UUID`() {
        `when`(worldBasis.read("w1", memberId, 2)).thenReturn(EpisodeWorldBasisResponse(4, null))

        val text = ok("episode_world_basis_read", mapOf("id" to "w1", "number" to 2))

        assertTrue(text.contains("\"revision\":4"), text)
        verify(worldBasis).read("w1", memberId, 2)
    }

    @Test fun `episode_world_basis_choose binds UUID ids and passes the caller as a UUID`() {
        val request = EpisodeWorldBasisRequest(world, revisionId, 1)
        `when`(worldBasis.choose("w1", memberId, 2, request)).thenReturn(EpisodeWorldBasisResponse(2, null))

        val text = ok("episode_world_basis_choose", mapOf("id" to "w1", "number" to 2, "data" to worldBasisJson))

        assertTrue(text.contains("\"revision\":2"), text)
        verify(worldBasis).choose("w1", memberId, 2, request)
    }

    @Test fun `episode_version_save forwards the draft request`() {
        `when`(versions.save("w1", member, 2, DraftRequest("제목", "본문", 3, "작가의 말"))).thenReturn(episode(2))

        val text = ok("episode_version_save", mapOf("id" to "w1", "number" to 2, "data" to draftJson))

        assertTrue(text.contains("\"title\":\"제목 2\""), text)
        verify(versions).save("w1", member, 2, DraftRequest("제목", "본문", 3, "작가의 말"))
    }

    @Test fun `episode_version_restore forwards the revert request`() {
        `when`(versions.restore("w1", member, 2, RevertRequest(3, "v-1"))).thenReturn(episode(2))

        val text = ok("episode_version_restore", mapOf("id" to "w1", "number" to 2, "data" to mapOf("revision" to 3, "versionId" to "v-1")))

        assertTrue(text.contains("\"title\":\"제목 2\""), text)
        verify(versions).restore("w1", member, 2, RevertRequest(3, "v-1"))
    }

    @Test fun `episode_save_current_draft returns only the draft like the controller`() {
        val saved = SavedEpisodeVersionResult(DraftResponse("제목", "본문", 4, "작가의 말"), VersionResponse("v-9", "제목", "본문", 4, 2, "2030-01-01T00:00:00Z", "작가의 말"))
        `when`(versions.saveCurrent("w1", member, DraftRequest("제목", "본문", 3, "작가의 말"))).thenReturn(saved)

        val text = ok("episode_save_current_draft", mapOf("id" to "w1", "data" to draftJson))

        assertEquals("""{"title":"제목","body":"본문","revision":4,"authorNote":"작가의 말"}""", text)
        verify(versions).saveCurrent("w1", member, DraftRequest("제목", "본문", 3, "작가의 말"))
    }

    @Test fun `episode_publish forwards the publish request`() {
        `when`(publication.publishEpisode("w1", member, 2, PublishRequest(3, true, true, true, "v-1"))).thenReturn(episode(2))

        val text = ok("episode_publish", mapOf("id" to "w1", "number" to 2, "data" to publishJson))

        assertTrue(text.contains("\"title\":\"제목 2\""), text)
        verify(publication).publishEpisode("w1", member, 2, PublishRequest(3, true, true, true, "v-1"))
    }

    @Test fun `episode_update_visibility forwards the visibility request and defaults rights confirmation to false`() {
        `when`(publication.visibility("w1", member, 2, PublicationVisibilityRequest(3, false))).thenReturn(episode(2))
        `when`(publication.visibility("w1", member, 4, PublicationVisibilityRequest(3, true, true))).thenReturn(episode(4))

        assertTrue(ok("episode_update_visibility", mapOf("id" to "w1", "number" to 2, "data" to mapOf("revision" to 3, "visible" to false))).contains("\"title\":\"제목 2\""))
        assertTrue(ok("episode_update_visibility", mapOf("id" to "w1", "number" to 4, "data" to mapOf("revision" to 3, "visible" to true, "rightsConfirmed" to true))).contains("\"title\":\"제목 4\""))
        verify(publication).visibility("w1", member, 2, PublicationVisibilityRequest(3, false))
        verify(publication).visibility("w1", member, 4, PublicationVisibilityRequest(3, true, true))
    }

    @Test fun `episode_publish_current publishes then returns the refreshed work like the controller`() {
        `when`(works.read("w1", member)).thenReturn(work("w1"))

        val text = ok("episode_publish_current", mapOf("id" to "w1", "data" to publishJson))

        assertTrue(text.contains("\"id\":\"w1\"") && text.contains("\"title\":\"제목 w1\""), text)
        val order = inOrder(publication, works)
        order.verify(publication).publishCurrent("w1", member, PublishRequest(3, true, true, true, "v-1"))
        order.verify(works).read("w1", member)
    }

    @Test fun `episode_schedule_list forwards the episode number`() {
        `when`(schedules.list("w1", member, 2)).thenReturn(listOf(schedule("s-1"), schedule("s-2")))

        val text = ok("episode_schedule_list", mapOf("id" to "w1", "number" to 2))

        assertTrue(text.startsWith("[{\"id\":\"s-1\"") && text.contains("\"id\":\"s-2\""), text)
        verify(schedules).list("w1", member, 2)
    }

    @Test fun `episode_schedule_create binds the instant and leaves an omitted revision null`() {
        val request = PublicationScheduleRequest("v-1", Instant.parse("2030-01-02T03:04:05Z"), true)
        `when`(schedules.create("w1", member, 2, request)).thenReturn(schedule("s-1"))

        val text = ok("episode_schedule_create", mapOf("id" to "w1", "number" to 2, "data" to scheduleJson - "revision"))

        assertTrue(text.contains("\"id\":\"s-1\""), text)
        verify(schedules).create("w1", member, 2, request)
    }

    @Test fun `episode_schedule_update forwards the schedule id and request`() {
        val request = PublicationScheduleRequest("v-1", Instant.parse("2030-01-02T03:04:05Z"), true, 4)
        `when`(schedules.update("w1", member, 2, "s-1", request)).thenReturn(schedule("s-1"))

        val text = ok("episode_schedule_update", mapOf("id" to "w1", "number" to 2, "scheduleId" to "s-1", "data" to scheduleJson))

        assertTrue(text.contains("\"id\":\"s-1\""), text)
        verify(schedules).update("w1", member, 2, "s-1", request)
    }

    @Test fun `episode_schedule_cancel forwards the schedule id and revision and reports completion`() {
        val text = ok("episode_schedule_cancel", mapOf("id" to "w1", "number" to 2, "scheduleId" to "s-1", "revision" to 4))

        assertEquals("\"Done\"", text)
        verify(schedules).cancel("w1", member, 2, "s-1", 4)
    }

    companion object {
        // 인증된 회원 ID(Principal 이름)는 UUID다. 세계관 기준 도구는 이를 UUID로 바꿔 Service에 넘긴다.
        private const val member = "11111111-1111-4111-8111-111111111111"
        private val memberId = UUID.fromString(member)
        private val world = UUID.fromString("22222222-2222-4222-8222-222222222222")
        private val revisionId = UUID.fromString("33333333-3333-4333-8333-333333333333")

        private val draftJson: Map<String, Any?> = mapOf("title" to "제목", "body" to "본문", "revision" to 3, "authorNote" to "작가의 말")
        private val publishJson: Map<String, Any?> = mapOf("revision" to 3, "rightsConfirmed" to true, "allowFork" to true, "allowForkPublication" to true, "versionId" to "v-1")
        private val scheduleJson: Map<String, Any?> = mapOf("versionId" to "v-1", "scheduledAt" to "2030-01-02T03:04:05Z", "rightsConfirmed" to true, "revision" to 4)
        private val worldBasisJson: Map<String, Any?> = mapOf("worldId" to world.toString(), "revisionId" to revisionId.toString(), "revision" to 1)

        /** 계약 '회차' 표(docs/design/content-mcp-contract.md)의 도구 이름이다. */
        private val contractTools = setOf(
            "episode_list", "episode_create", "episode_read", "episode_update_draft", "episode_order_scope", "episode_delete_draft", "episode_delete",
            "episode_world_basis_read", "episode_world_basis_choose", "episode_version_save", "episode_version_restore", "episode_save_current_draft",
            "episode_publish", "episode_update_visibility", "episode_publish_current",
            "episode_schedule_list", "episode_schedule_create", "episode_schedule_update", "episode_schedule_cancel",
        )

        /** 도구별로 올바른 인자다. 등록·스키마·인증·오류 변환 검사가 같은 표를 쓴다. */
        private val validArgs: Map<String, Map<String, Any?>> = mapOf(
            "episode_list" to mapOf("id" to "w1"),
            "episode_create" to mapOf("id" to "w1", "data" to mapOf("title" to "새 회차")),
            "episode_read" to mapOf("id" to "w1", "number" to 2),
            "episode_update_draft" to mapOf("id" to "w1", "number" to 2, "data" to draftJson),
            "episode_order_scope" to mapOf("id" to "w1", "number" to 2),
            "episode_delete_draft" to mapOf("id" to "w1", "number" to 2, "revision" to 5),
            "episode_delete" to mapOf("id" to "w1", "number" to 2, "revision" to 5),
            "episode_world_basis_read" to mapOf("id" to "w1", "number" to 2),
            "episode_world_basis_choose" to mapOf("id" to "w1", "number" to 2, "data" to worldBasisJson),
            "episode_version_save" to mapOf("id" to "w1", "number" to 2, "data" to draftJson),
            "episode_version_restore" to mapOf("id" to "w1", "number" to 2, "data" to mapOf("revision" to 3, "versionId" to "v-1")),
            "episode_save_current_draft" to mapOf("id" to "w1", "data" to draftJson),
            "episode_publish" to mapOf("id" to "w1", "number" to 2, "data" to publishJson),
            "episode_update_visibility" to mapOf("id" to "w1", "number" to 2, "data" to mapOf("revision" to 3, "visible" to true, "rightsConfirmed" to true)),
            "episode_publish_current" to mapOf("id" to "w1", "data" to publishJson),
            "episode_schedule_list" to mapOf("id" to "w1", "number" to 2),
            "episode_schedule_create" to mapOf("id" to "w1", "number" to 2, "data" to scheduleJson),
            "episode_schedule_update" to mapOf("id" to "w1", "number" to 2, "scheduleId" to "s-1", "data" to scheduleJson),
            "episode_schedule_cancel" to mapOf("id" to "w1", "number" to 2, "scheduleId" to "s-1", "revision" to 4),
        )

        @JvmStatic fun toolNames(): List<String> = validArgs.keys.toList()

        /** (도구, 컨트롤러가 422로 거절하던 인자, 위반 필드). 본문을 받는 도구마다 하나, 그리고 예약 취소의 음수 revision이다. */
        @JvmStatic fun invalidInputs(): List<Arguments> = listOf(
            Arguments.of("episode_create", mapOf("id" to "w1", "data" to mapOf("title" to " ")), "title"),
            Arguments.of("episode_update_draft", mapOf("id" to "w1", "number" to 2, "data" to draftJson + ("revision" to -1)), "revision"),
            Arguments.of("episode_world_basis_choose", mapOf("id" to "w1", "number" to 2, "data" to worldBasisJson + ("revision" to -1)), "revision"),
            Arguments.of("episode_version_save", mapOf("id" to "w1", "number" to 2, "data" to draftJson + ("title" to "가".repeat(121))), "title"),
            Arguments.of("episode_version_restore", mapOf("id" to "w1", "number" to 2, "data" to mapOf("revision" to 3, "versionId" to "")), "versionId"),
            Arguments.of("episode_save_current_draft", mapOf("id" to "w1", "data" to draftJson + ("body" to "가".repeat(40001))), "body"),
            Arguments.of("episode_publish", mapOf("id" to "w1", "number" to 2, "data" to publishJson + ("revision" to -1)), "revision"),
            Arguments.of("episode_update_visibility", mapOf("id" to "w1", "number" to 2, "data" to mapOf("revision" to -1, "visible" to true)), "revision"),
            Arguments.of("episode_publish_current", mapOf("id" to "w1", "data" to publishJson + ("revision" to -1)), "revision"),
            Arguments.of("episode_schedule_create", mapOf("id" to "w1", "number" to 2, "data" to scheduleJson + ("versionId" to "")), "versionId"),
            Arguments.of("episode_schedule_update", mapOf("id" to "w1", "number" to 2, "scheduleId" to "s-1", "data" to scheduleJson + ("revision" to -1)), "revision"),
            Arguments.of("episode_schedule_cancel", mapOf("id" to "w1", "number" to 2, "scheduleId" to "s-1", "revision" to -1), "revision"),
        )
    }
}
