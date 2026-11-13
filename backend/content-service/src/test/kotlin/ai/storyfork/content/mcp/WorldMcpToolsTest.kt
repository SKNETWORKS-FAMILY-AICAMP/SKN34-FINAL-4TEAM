package ai.storyfork.content.mcp

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode_version.service.dto.RevertRequest
import ai.storyfork.content.world.service.WorldCheckpointService
import ai.storyfork.content.world.service.WorldService
import ai.storyfork.content.world.service.dto.*
import io.modelcontextprotocol.common.McpTransportContext
import io.modelcontextprotocol.spec.McpSchema.CallToolRequest
import io.modelcontextprotocol.spec.McpSchema.CallToolResult
import io.modelcontextprotocol.spec.McpSchema.TextContent
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.ai.mcp.annotation.McpTool
import org.springframework.ai.mcp.annotation.spring.SyncMcpAnnotationProviders
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder

/** 작품 세계관·체크포인트 도구(8개)가 기존 Service 함수의 어댑터일 뿐임을 확인한다. Spring context 없이 실제 `@McpTool` 호출 경로를 지난다. */
class WorldMcpToolsTest {
    private val worlds = mock(WorldService::class.java)
    private val checkpoints = mock(WorldCheckpointService::class.java)
    private val specs = SyncMcpAnnotationProviders.statelessToolSpecifications(listOf<Any>(WorldMcpTools(worlds, checkpoints)))
    private val member = "11111111-1111-1111-1111-111111111111"

    @AfterEach fun clear() = SecurityContextHolder.clearContext()

    private fun signedIn(): McpTransportContext {
        SecurityContextHolder.getContext().authentication = UsernamePasswordAuthenticationToken.authenticated(member, null, emptyList())
        return mcpCallerContext()
    }

    private fun call(tool: String, args: Map<String, Any?>, context: McpTransportContext = McpTransportContext.EMPTY): CallToolResult =
        specs.single { it.tool().name() == tool }.callHandler().apply(context, CallToolRequest.builder(tool).arguments(args).build())

    private fun CallToolResult.text() = (content().single() as TextContent).text()

    private fun world(id: String = "w1") = WorldResponse(id, "달빛 서점 설정집", 3, "own", null, null, emptyList(), emptyList(), emptyList(), "token-1", emptyList())

    // 계약 docs/design/content-mcp-contract.md '### 세계관' 표(25개) 전체다. 두 클래스(WorldMcpTools·WorldStudioMcpTools)의 합이어야 한다.
    private val contractWorldTools = listOf(
        "work_world_read", "work_world_public_read", "work_setting_draft", "work_setting_commit", "work_setting_revert",
        "world_checkpoint_create", "world_checkpoint_list", "world_checkpoint_read",
        "world_studio_list", "world_studio_create", "world_studio_read", "world_studio_edit_draft", "world_studio_save_revision",
        "world_studio_update_publication", "world_studio_revisions", "world_studio_revision_read",
        "world_studio_public_list", "world_studio_public_read",
        "world_analysis_create", "world_analysis_list", "world_analysis_read", "world_analysis_candidates",
        "world_analysis_decide", "world_analysis_apply", "world_analysis_application_read",
    )

    // 도구마다 호출해 볼 수 있는 최소 유효 인자다(로그인 필요 도구).
    private val userTools: Map<String, Map<String, Any?>> = mapOf(
        "work_world_read" to mapOf("id" to "w1"),
        "work_setting_draft" to mapOf("id" to "w1", "sid" to "s1", "data" to mapOf("revision" to 2, "setting" to mapOf("name" to "왕국"), "sourceToken" to "tok")),
        "work_setting_commit" to mapOf("id" to "w1", "sid" to "s1", "data" to mapOf("revision" to 4)),
        "work_setting_revert" to mapOf("id" to "w1", "sid" to "s1", "data" to mapOf("revision" to 5, "versionId" to "v1")),
        "world_checkpoint_create" to mapOf("id" to "w1"),
        "world_checkpoint_list" to mapOf("id" to "w1"),
        "world_checkpoint_read" to mapOf("id" to "w1", "checkpointId" to "c1"),
    )

    @Test fun `the two world tool classes register exactly the contract world tools`() {
        val registered = listOf(WorldMcpTools::class.java, WorldStudioMcpTools::class.java)
            .flatMap { it.declaredMethods.toList() }.mapNotNull { it.getAnnotation(McpTool::class.java)?.name }

        assertEquals(contractWorldTools.sorted(), registered.sorted())
    }

    @Test fun `this class registers the work world and checkpoint tools and only the lookups are read-only`() {
        assertEquals((userTools.keys + "work_world_public_read").sorted(), specs.map { it.tool().name() }.sorted())
        val readOnly = specs.filter { it.tool().annotations()?.readOnlyHint() == true }.map { it.tool().name() }

        assertEquals(setOf("work_world_read", "work_world_public_read", "world_checkpoint_list", "world_checkpoint_read"), readOnly.toSet())
    }

    @Test fun `no tool takes a member id because the caller comes only from the verified token`() {
        for (spec in specs) {
            val names = (spec.tool().inputSchema()["properties"] as Map<*, *>).keys.map { it.toString().lowercase() }

            assertTrue(names.none { "member" in it || "owner" in it || "principal" in it || "context" in it }, "${spec.tool().name()} $names")
        }
    }

    @Test fun `work_world_read forwards the work id and the caller as owner`() {
        `when`(worlds.read("w1", member)).thenReturn(world())

        val result = call("work_world_read", mapOf("id" to "w1"), signedIn())

        assertNotEquals(true, result.isError())
        assertTrue(result.text().contains("\"sourceToken\":\"token-1\""), result.text())
        verify(worlds).read("w1", member)
    }

    @Test fun `work_world_public_read is public and forwards the work id and episode`() {
        `when`(worlds.publicRead("w1", 2)).thenReturn(ReadingWorldResponse("w1", 2, emptyList()))

        val result = call("work_world_public_read", mapOf("id" to "w1", "episode" to 2))

        assertNotEquals(true, result.isError())
        assertTrue(result.text().contains("\"episode\":2"), result.text())
        verify(worlds).publicRead("w1", 2)
    }

    @Test fun `work_world_public_read requires the episode like the controller request parameter`() {
        val schema = specs.single { it.tool().name() == "work_world_public_read" }.tool().inputSchema()

        assertEquals(setOf("id", "episode"), (schema["properties"] as Map<*, *>).keys)
        assertEquals(setOf("id", "episode"), (schema["required"] as List<*>).toSet())
    }

    @Test fun `work_setting_draft forwards ids the caller and the same request DTO`() {
        val request = SettingRequest(2, SettingPayload(name = "왕국", content = "북쪽의 왕국"), "tok")
        `when`(worlds.saveDraft("w1", "s1", member, request)).thenReturn(world())

        val result = call("work_setting_draft", mapOf("id" to "w1", "sid" to "s1",
            "data" to mapOf("revision" to 2, "setting" to mapOf("name" to "왕국", "content" to "북쪽의 왕국"), "sourceToken" to "tok")), signedIn())

        assertNotEquals(true, result.isError())
        verify(worlds).saveDraft("w1", "s1", member, request)
    }

    @Test fun `work_setting_commit forwards ids the caller and the revision`() {
        `when`(worlds.commit("w1", "s1", member, 4)).thenReturn(world())

        val result = call("work_setting_commit", userTools.getValue("work_setting_commit"), signedIn())

        assertNotEquals(true, result.isError())
        verify(worlds).commit("w1", "s1", member, 4)
    }

    @Test fun `work_setting_revert forwards ids the caller and the same request DTO`() {
        `when`(worlds.revert("w1", "s1", member, RevertRequest(5, "v1"))).thenReturn(world())

        val result = call("work_setting_revert", userTools.getValue("work_setting_revert"), signedIn())

        assertNotEquals(true, result.isError())
        verify(worlds).revert("w1", "s1", member, RevertRequest(5, "v1"))
    }

    @Test fun `DTO constraints the controller enforces with Valid are enforced for tools and the service is not called`() {
        val invalid = mapOf(
            "work_setting_draft" to (mapOf("id" to "w1", "sid" to "s1", "data" to mapOf("revision" to -1, "setting" to mapOf("name" to "왕국"), "sourceToken" to " ")) to "revision, sourceToken"),
            "work_setting_commit" to (mapOf("id" to "w1", "sid" to "s1", "data" to mapOf("revision" to -1)) to "revision"),
            "work_setting_revert" to (mapOf("id" to "w1", "sid" to "s1", "data" to mapOf("revision" to 0, "versionId" to "")) to "versionId"),
        )
        for ((tool, case) in invalid) {
            val result = call(tool, case.first, signedIn())

            assertEquals(true, result.isError(), tool)
            assertEquals(listOf("HTTP 422", "입력 길이·회차·필수 항목을 확인해 주세요: ${case.second}"), result.text().lines(), tool)
        }
        verifyNoInteractions(worlds)
    }

    @Test fun `world_checkpoint_create forwards the work id and the caller`() {
        `when`(checkpoints.create("w1", member)).thenReturn(WorldCheckpointResponse("c1", "2026-11-13T00:00:00Z", emptyList()))

        val result = call("world_checkpoint_create", mapOf("id" to "w1"), signedIn())

        assertNotEquals(true, result.isError())
        assertTrue(result.text().contains("\"id\":\"c1\""), result.text())
        verify(checkpoints).create("w1", member)
    }

    @Test fun `world_checkpoint_list forwards the work id and the caller`() {
        `when`(checkpoints.list("w1", member)).thenReturn(listOf(WorldCheckpointSummary("c1", "2026-11-13T00:00:00Z")))

        val result = call("world_checkpoint_list", mapOf("id" to "w1"), signedIn())

        assertNotEquals(true, result.isError())
        assertEquals("""[{"id":"c1","createdAt":"2026-11-13T00:00:00Z"}]""", result.text())
        verify(checkpoints).list("w1", member)
    }

    @Test fun `world_checkpoint_read forwards the work id the caller and the checkpoint id in the service order`() {
        `when`(checkpoints.read("w1", member, "c1")).thenReturn(WorldCheckpointResponse("c1", "2026-11-13T00:00:00Z", listOf(SettingPayload(name = "왕국"))))

        val result = call("world_checkpoint_read", mapOf("id" to "w1", "checkpointId" to "c1"), signedIn())

        assertNotEquals(true, result.isError())
        assertTrue(result.text().contains("\"name\":\"왕국\""), result.text())
        verify(checkpoints).read("w1", member, "c1")
    }

    @Test fun `a user tool without a caller is a 401 tool error and never reaches a service`() {
        for ((tool, args) in userTools) {
            val result = call(tool, args)

            assertEquals(true, result.isError(), tool)
            assertEquals("HTTP 401 AUTHENTICATION_REQUIRED", result.text().lines().first(), tool)
        }
        verifyNoInteractions(worlds, checkpoints)
    }

    @Test fun `service failures keep their HTTP status and detail`() {
        `when`(worlds.saveDraft("w1", "s1", member, SettingRequest(2, SettingPayload(name = "왕국"), "tok")))
            .thenThrow(ContentFailure(409, "설정집이 변경됐어요. 최신 데이터를 불러와 주세요."))

        val result = call("work_setting_draft", userTools.getValue("work_setting_draft"), signedIn())

        assertEquals(true, result.isError())
        assertEquals(listOf("HTTP 409", "설정집이 변경됐어요. 최신 데이터를 불러와 주세요."), result.text().lines())
    }
}
