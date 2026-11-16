package ai.storyfork.content.mcp

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import io.modelcontextprotocol.common.McpTransportContext
import io.modelcontextprotocol.spec.McpSchema.CallToolRequest
import io.modelcontextprotocol.spec.McpSchema.CallToolResult
import io.modelcontextprotocol.spec.McpSchema.TextContent
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.ai.mcp.annotation.McpTool
import org.springframework.ai.mcp.annotation.McpToolParam
import org.springframework.ai.mcp.annotation.spring.SyncMcpAnnotationProviders
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder

/**
 * 모든 도구 클래스가 따르는 형식의 기준 예시와 그 계약이다. 실제 Spring AI의 `@McpTool` 호출 경로(인자 바인딩·스키마·오류 변환)를
 * Spring context 없이 그대로 지나가며, 서비스 대신 [ProbeTools]를 쓴다.
 */
class McpToolConventionTest {
    class ProbeTools {
        // 공개 도구: 호출자 없이 Service를 부르고, 선택 인자는 required=false다(@McpToolParam이 있으면 널 허용만으로는 필수로 잡힌다).
        @McpTool(name = "probe_public", description = "공개 도구 예시")
        fun publicEcho(@McpToolParam(description = "검색어", required = false) q: String?): String = mcpTool { "q=$q" }

        // 사용자 도구: 호출자 회원은 transport context에서만 얻고 도구 인자로 받지 않는다.
        @McpTool(name = "probe_user", description = "사용자 도구 예시")
        fun user(context: McpTransportContext, @McpToolParam(description = "작품 ID") id: String): String =
            mcpTool { "${context.requireCaller().memberId}/$id" }

        // 공개 조회 중 회원을 선택으로 받는 도구(예: 좋아요 여부): 익명이면 null이다.
        @McpTool(name = "probe_optional", description = "선택 회원 도구 예시")
        fun optional(context: McpTransportContext): String = mcpTool { context.callerOrNull()?.memberId ?: "anonymous" }

        @McpTool(name = "probe_create", description = "DTO 입력 예시")
        fun create(@McpToolParam(description = "작품 생성 입력") data: CreateWorkRequest): String =
            mcpTool { "${data.title}|${data.summary}|${data.genres}" }

        // 컨트롤러의 `@Valid @RequestBody`는 MCP 인자에 적용되지 않으므로 DTO 입력은 validated()로 같은 제약을 검사한다.
        @McpTool(name = "probe_validated", description = "DTO 검증 예시")
        fun validated(@McpToolParam(description = "작품 생성 입력") data: CreateWorkRequest): String = mcpTool { data.validated().title }

        @McpTool(name = "probe_fail", description = "예외 변환 확인용")
        fun fail(@McpToolParam(description = "던질 예외 종류") kind: String): String = mcpTool {
            when (kind) {
                "content" -> throw ContentFailure(404, "작품을 찾을 수 없어요.")
                "coded" -> throw ContentFailure(409, "다른 변경과 충돌했어요.", "WORLD_CONFLICT")
                "core" -> throw CoreAuthException(503, "CORE_AUTH_UNAVAILABLE", "인증 서비스를 사용할 수 없습니다.")
                "checked" -> throw java.io.IOException("원고 본문 일부")
                else -> throw IllegalStateException("원고 본문 일부")
            }
        }
    }

    private val specs = SyncMcpAnnotationProviders.statelessToolSpecifications(listOf<Any>(ProbeTools()))

    @AfterEach fun clear() = SecurityContextHolder.clearContext()

    private fun call(tool: String, args: Map<String, Any?> = emptyMap(), context: McpTransportContext = McpTransportContext.EMPTY): CallToolResult =
        specs.single { it.tool().name() == tool }.callHandler().apply(context, CallToolRequest.builder(tool).arguments(args).build())

    private fun CallToolResult.text() = (content().single() as TextContent).text()

    private fun contextOf(memberId: String): McpTransportContext {
        SecurityContextHolder.getContext().authentication = UsernamePasswordAuthenticationToken.authenticated(memberId, null, emptyList())
        return mcpCallerContext()
    }

    @Test fun `the transport context is hidden from the schema and optional arguments are not required`() {
        val user = specs.single { it.tool().name() == "probe_user" }.tool().inputSchema()
        val optional = specs.single { it.tool().name() == "probe_public" }.tool().inputSchema()

        assertEquals(setOf("id"), (user["properties"] as Map<*, *>).keys)
        assertEquals(listOf("id"), user["required"])
        assertEquals(setOf("q"), (optional["properties"] as Map<*, *>).keys)
        assertEquals(emptyList<String>(), optional["required"])
    }

    @Test fun `argument names reach the method so Kotlin parameter names must survive compilation`() {
        assertEquals("q=달빛", call("probe_public", mapOf("q" to "달빛")).text())
        assertEquals("q=null", call("probe_public").text())
    }

    @Test fun `a user tool gets the caller from the transport context`() {
        val result = call("probe_user", mapOf("id" to "work-1"), contextOf("member-1"))

        assertNotEquals(true, result.isError())
        assertEquals("member-1/work-1", result.text())
    }

    @Test fun `a user tool without a caller is a 401 tool error`() {
        val result = call("probe_user", mapOf("id" to "work-1"))

        assertEquals(true, result.isError())
        assertEquals("HTTP 401 AUTHENTICATION_REQUIRED", result.text().lines().first())
        assertTrue(result.text().lines().drop(1).all { it.isNotBlank() })
    }

    @Test fun `an optional caller is the member when present and null for anonymous`() {
        assertEquals("anonymous", call("probe_optional").text())
        assertEquals("member-2", call("probe_optional", context = contextOf("member-2")).text())
    }

    @Test fun `Kotlin DTO arguments bind from JSON objects with their defaults`() {
        val result = call("probe_create", mapOf("data" to mapOf("title" to "달빛 서점", "genres" to listOf("판타지"))))

        assertEquals("달빛 서점||[판타지]", result.text())
    }

    @Test fun `DTO constraints that the controller enforces with Valid are enforced for tools too`() {
        assertEquals("달빛 서점", call("probe_validated", mapOf("data" to mapOf("title" to "달빛 서점"))).text())

        val tooLong = "가".repeat(2001)
        val result = call("probe_validated", mapOf("data" to mapOf("title" to "", "summary" to tooLong)))

        assertEquals(true, result.isError())
        // 위반한 필드 이름만 알리고 입력 값은 되돌려 주지 않는다.
        assertEquals(listOf("HTTP 422", "입력 길이·회차·필수 항목을 확인해 주세요: summary, title"), result.text().lines())
    }

    @Test fun `service failures become tool errors that keep the HTTP status code and detail`() {
        val expected = mapOf(
            "content" to listOf("HTTP 404", "작품을 찾을 수 없어요."),
            "coded" to listOf("HTTP 409 WORLD_CONFLICT", "다른 변경과 충돌했어요."),
            "core" to listOf("HTTP 503 CORE_AUTH_UNAVAILABLE", "인증 서비스를 사용할 수 없습니다."),
        )
        for ((kind, lines) in expected) {
            val result = call("probe_fail", mapOf("kind" to kind))

            assertEquals(true, result.isError(), kind)
            assertEquals(lines, result.text().lines(), kind)
        }
    }

    @Test fun `unknown failures are still errors but never echo their message`() {
        for (kind in listOf("checked", "other")) {
            val result = call("probe_fail", mapOf("kind" to kind))

            assertEquals(true, result.isError(), kind)
            assertEquals(listOf("HTTP 500", "요청을 처리하지 못했어요."), result.text().lines(), kind)
            assertFalse(result.text().contains("원고"), kind)
        }
    }
}
