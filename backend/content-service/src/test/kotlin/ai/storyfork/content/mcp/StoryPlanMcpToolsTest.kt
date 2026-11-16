package ai.storyfork.content.mcp

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.plan.service.StoryPlanService
import ai.storyfork.content.plan.service.dto.StoryPlanRequest
import io.modelcontextprotocol.common.McpTransportContext
import io.modelcontextprotocol.spec.McpSchema.CallToolRequest
import io.modelcontextprotocol.spec.McpSchema.CallToolResult
import io.modelcontextprotocol.spec.McpSchema.TextContent
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.TestFactory
import org.mockito.Mockito.*
import org.mockito.stubbing.Answer
import org.springframework.ai.mcp.annotation.spring.SyncMcpAnnotationProviders
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder

private const val ME = "member-1"
private const val WORK = "work-1"
private const val PLAN = "plan-1"

/**
 * `story_plan_*` 도구가 기존 [StoryPlanService]의 어댑터일 뿐임을 확인한다. Spring context 없이 실제 `@McpTool` 호출 경로를 지난다.
 * 작품·계획·회원 ID는 모두 문자열이라 서로 다른 값을 써서 인자 순서를 바꿔 넘기는 실수를 잡는다.
 */
class StoryPlanMcpToolsTest {
    private val service = mock(StoryPlanService::class.java)
    private val specs = SyncMcpAnnotationProviders.statelessToolSpecifications(listOf<Any>(StoryPlanMcpTools(service)))

    private fun call(tool: String, args: Map<String, Any?> = emptyMap(), context: McpTransportContext = McpTransportContext.EMPTY): CallToolResult =
        specs.single { it.tool().name() == tool }.callHandler().apply(context, CallToolRequest.builder(tool).arguments(args).build())

    private fun CallToolResult.text() = (content().single() as TextContent).text()

    /** 기존 `ContentAuthenticationFilter`가 만드는 인증과 같은 모양으로 호출자를 싣는다(Principal 이름은 회원 UUID). */
    private fun signedIn(): McpTransportContext {
        SecurityContextHolder.getContext().authentication = UsernamePasswordAuthenticationToken.authenticated(ME, null, emptyList())
        try {
            return mcpCallerContext()
        } finally {
            SecurityContextHolder.clearContext()
        }
    }

    private val scene = mapOf(
        "kind" to "scene", "parentId" to "plot-1", "title" to "첫 장면", "content" to "내용", "episodeNumber" to 2,
        "characterIds" to listOf("character-1"), "placeIds" to listOf("place-1"), "revision" to 3,
    )
    private val sceneRequest = StoryPlanRequest("scene", "plot-1", "첫 장면", "내용", 2, listOf("character-1"), listOf("place-1"), 3)

    private inner class Case(val tool: String, val args: Map<String, Any?>, val reaches: () -> Unit)

    private fun cases(): List<Case> = listOf(
        Case("story_plan_list", mapOf("workId" to WORK)) { verify(service).list(WORK, ME) },
        Case("story_plan_read", mapOf("workId" to WORK, "id" to PLAN)) { verify(service).read(WORK, ME, PLAN) },
        Case("story_plan_create", mapOf("workId" to WORK, "data" to scene)) { verify(service).create(WORK, ME, sceneRequest) },
        Case("story_plan_update", mapOf("workId" to WORK, "id" to PLAN, "data" to scene)) { verify(service).update(WORK, ME, PLAN, sceneRequest) },
        Case("story_plan_delete", mapOf("workId" to WORK, "id" to PLAN, "revision" to 5)) { verify(service).delete(WORK, ME, PLAN, 5) },
    )

    @TestFactory fun `each tool passes its arguments and the verified member to the same service function`(): List<DynamicTest> =
        cases().map { case ->
            dynamicTest("${case.tool} forwards to the service") {
                reset(service)

                val result = call(case.tool, case.args, signedIn())

                assertNotEquals(true, result.isError(), "${case.tool}: ${result.content()}")
                case.reaches()
            }
        }

    @TestFactory fun `a tool without a caller is a 401 tool error and never reaches the service`(): List<DynamicTest> =
        cases().map { case ->
            dynamicTest("${case.tool} needs a caller") {
                reset(service)

                val result = call(case.tool, case.args)

                assertEquals(true, result.isError(), case.tool)
                assertEquals("HTTP 401 AUTHENTICATION_REQUIRED", result.text().lines().first(), case.tool)
                verifyNoInteractions(service)
            }
        }

    // `mcpTool {}`를 빠뜨린 도구는 상태·코드가 빠진 채 나가므로, 모든 Service 호출이 던지는 대역으로 모든 도구를 확인한다.
    @TestFactory fun `every tool reports a service failure with the status code and detail of the existing API`(): List<DynamicTest> {
        val fail = Answer<Any> { throw ContentFailure(409, "다른 변경과 충돌했어요.", "SOME_CODE") }
        val failing = SyncMcpAnnotationProviders.statelessToolSpecifications(listOf<Any>(StoryPlanMcpTools(mock(StoryPlanService::class.java, fail))))
        return cases().map { case ->
            dynamicTest("${case.tool} reports the failure") {
                val request = CallToolRequest.builder(case.tool).arguments(case.args).build()

                val result = failing.single { it.tool().name() == case.tool }.callHandler().apply(signedIn(), request)

                assertEquals(true, result.isError(), case.tool)
                assertEquals(listOf("HTTP 409 SOME_CODE", "다른 변경과 충돌했어요."), result.text().lines(), case.tool)
            }
        }
    }

    // 컨트롤러의 `@Valid @RequestBody`와 같은 제약을 도구도 지킨다(Service는 호출하지 않는다).
    @TestFactory fun `a plan that the controller rejects with Valid is a 422 tool error that names only the fields`(): List<DynamicTest> =
        listOf(
            Triple("story_plan_create", mapOf("workId" to WORK, "data" to scene + ("title" to "")), "title"),
            Triple("story_plan_update", mapOf("workId" to WORK, "id" to PLAN, "data" to scene + ("episodeNumber" to 0)), "episodeNumber"),
        ).map { (tool, args, fields) ->
            dynamicTest("$tool validates its input") {
                reset(service)

                val result = call(tool, args, signedIn())

                assertEquals(true, result.isError(), tool)
                assertEquals(listOf("HTTP 422", "입력 길이·회차·필수 항목을 확인해 주세요: $fields"), result.text().lines(), tool)
                verifyNoInteractions(service)
            }
        }
}
