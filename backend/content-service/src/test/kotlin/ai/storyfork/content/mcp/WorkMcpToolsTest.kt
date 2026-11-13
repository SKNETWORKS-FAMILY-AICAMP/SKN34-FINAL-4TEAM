package ai.storyfork.content.mcp

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.WorkListResponse
import ai.storyfork.content.work.service.dto.WorkResponse
import io.modelcontextprotocol.common.McpTransportContext
import io.modelcontextprotocol.spec.McpSchema.CallToolRequest
import io.modelcontextprotocol.spec.McpSchema.CallToolResult
import io.modelcontextprotocol.spec.McpSchema.TextContent
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.ai.mcp.annotation.spring.SyncMcpAnnotationProviders

/** `work_public_list`가 기존 Service 함수의 어댑터일 뿐임을 확인한다. Spring context 없이 실제 `@McpTool` 호출 경로를 지난다. */
class WorkMcpToolsTest {
    private val service = mock(WorkService::class.java)
    private val specs = SyncMcpAnnotationProviders.statelessToolSpecifications(listOf<Any>(WorkMcpTools(service)))
    private val tool = specs.single { it.tool().name() == "work_public_list" }

    private fun call(args: Map<String, Any?>): CallToolResult =
        tool.callHandler().apply(McpTransportContext.EMPTY, CallToolRequest.builder("work_public_list").arguments(args).build())

    private fun CallToolResult.text() = (content().single() as TextContent).text()

    private fun work(id: String) = WorkResponse(id, "제목 $id", "소개", "public", true, true, null, emptyList(), null)

    @Test fun `work_public_list is a read-only public tool whose search arguments are all optional`() {
        val schema = tool.tool().inputSchema()

        assertEquals(setOf("q", "f", "sort", "page", "size"), (schema["properties"] as Map<*, *>).keys)
        assertEquals(emptyList<String>(), schema["required"])
        assertEquals(true, tool.tool().annotations().readOnlyHint())
    }

    @Test fun `it forwards its arguments to WorkService publicList unchanged and returns the same list`() {
        `when`(service.publicList("달빛", "tag", "view", "0", "10")).thenReturn(WorkListResponse(listOf(work("w1"))))

        val result = call(mapOf("q" to "달빛", "f" to "tag", "sort" to "view", "page" to "0", "size" to "10"))

        assertNotEquals(true, result.isError())
        assertTrue(result.text().contains("\"id\":\"w1\""), result.text())
        assertTrue(result.text().contains("\"title\":\"제목 w1\""), result.text())
        verify(service).publicList("달빛", "tag", "view", "0", "10")
    }

    @Test fun `omitted arguments are passed as null so the service applies its own defaults`() {
        `when`(service.publicList(null, null, null, null, null)).thenReturn(WorkListResponse(emptyList()))

        val result = call(emptyMap())

        assertNotEquals(true, result.isError())
        assertEquals("[]", result.text())
        verify(service).publicList(null, null, null, null, null)
    }

    @Test fun `a service failure is a tool error with the HTTP status and detail`() {
        `when`(service.publicList(null, "bad", null, null, null)).thenThrow(ContentFailure(422, "검색 범위를 확인해 주세요."))

        val result = call(mapOf("f" to "bad"))

        assertEquals(true, result.isError())
        assertEquals(listOf("HTTP 422", "검색 범위를 확인해 주세요."), result.text().lines())
    }
}
