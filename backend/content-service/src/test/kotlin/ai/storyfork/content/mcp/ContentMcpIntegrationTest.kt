package ai.storyfork.content.mcp

import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
import ai.storyfork.content.auth.service.CoreNicknameService
import io.modelcontextprotocol.common.McpTransportContext
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.mockito.Mockito.`when`
import org.springframework.ai.mcp.annotation.McpTool
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.http.HttpStatus
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.web.client.HttpClientErrorException
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/**
 * `/mcp` 체인과 도구 실행의 실제 HTTP 경계다(CI 전용, 로컬 실행 금지). 공개 도구는 토큰·CSRF 없이 불리고,
 * 사용자 도구의 호출자는 기존 `ContentAuthenticationFilter`가 확인한 회원이며, 기존 `/api/v1` 아래 체인은 그대로다.
 * 프로브 도구를 더하므로 별도 컨텍스트를 띄우지만 환경 속성은 [ai.storyfork.content.regression.AuthContentIntegrationTest]와 같다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = [
    "DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}",
    "DATABASE_USER=content_test", "DATABASE_PASSWORD=",
    "CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32",
    "OPERATIONS_SERVICE_TOKEN=fork-integrity-test-token-fixture-000",
])
@EnabledIfEnvironmentVariable(named = "TEST_CONTENT_DATABASE_URL", matches = ".+")
@Import(ContentMcpIntegrationTest.ProbeConfig::class)
class ContentMcpIntegrationTest {
    // 호출자 전달 경로(필터 → SecurityContext → extractor → transport context → 도구)를 실제 HTTP로 확인하는 테스트 전용 도구다.
    class ProbeTools {
        @McpTool(name = "probe_whoami", description = "호출자 확인용(테스트 전용)")
        fun whoami(context: McpTransportContext): String = mcpTool { context.requireCaller().let { "${it.memberId}:${it.operator}" } }
    }

    @TestConfiguration(proxyBeanMethods = false)
    class ProbeConfig {
        @Bean fun probeTools() = ProbeTools()
    }

    // 작가명은 Core 닉네임이다. 이 테스트는 이름을 보지 않으므로 Core 조회는 대역이다.
    @MockitoBean lateinit var nicknames: CoreNicknameService
    @MockitoBean lateinit var core: CoreAuthClient
    @LocalServerPort var port = 0
    @Autowired lateinit var json: JsonMapper
    private val client = HttpClient.newHttpClient()

    private fun send(path: String, method: String = "GET", body: String? = null, bearer: String? = null, accept: String = "application/json"): HttpResponse<String> {
        val request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path")).header("Accept", accept)
        if (bearer != null) request.header("Authorization", "Bearer $bearer")
        if (body != null) request.header("Content-Type", "application/json")
        request.method(method, if (body == null) HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(body))
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString())
    }

    // CSRF 토큰·쿠키 없이 보낸다. MCP 클라이언트는 이런 요청이다.
    private fun rpc(method: String, params: String, bearer: String? = null) =
        send("/mcp", "POST", """{"jsonrpc":"2.0","id":1,"method":"$method","params":$params}""", bearer, "application/json, text/event-stream")

    private fun toolCall(name: String, bearer: String? = null) = rpc("tools/call", """{"name":"$name","arguments":{}}""", bearer)

    private fun result(response: HttpResponse<String>): JsonNode {
        assertEquals(200, response.statusCode(), response.body())
        return json.readTree(response.body()).path("result")
    }

    private fun text(result: JsonNode) = result.path("content").path(0).path("text").asString()

    private fun member(operator: Boolean = false): UUID {
        val id = UUID.randomUUID()
        `when`(core.verify("Bearer $id")).thenReturn(VerifiedMemberResponse(id, operator))
        return id
    }

    @Test fun `tools are registered from the annotated beans`() {
        val names = result(rpc("tools/list", "{}")).path("tools").values().map { it.path("name").asString() }

        assertTrue(names.containsAll(listOf("work_public_list", "probe_whoami")), names.toString())
    }

    @Test fun `a public tool runs without a token and without CSRF`() {
        val result = result(toolCall("work_public_list"))

        assertFalse(result.path("isError").asBoolean(false), result.toString())
        assertTrue(text(result).startsWith("["), text(result))
    }

    @Test fun `a user tool sees the member and operator flag that the existing filter verified`() {
        val plain = member()
        val operator = member(operator = true)

        assertEquals("$plain:false", text(result(toolCall("probe_whoami", plain.toString()))))
        assertEquals("$operator:true", text(result(toolCall("probe_whoami", operator.toString()))))
    }

    @Test fun `a user tool without a token is a tool error rather than an HTTP error`() {
        val result = result(toolCall("probe_whoami"))

        assertTrue(result.path("isError").asBoolean(false), result.toString())
        assertEquals("HTTP 401 AUTHENTICATION_REQUIRED", text(result).lines().first())
    }

    @Test fun `a bearer that Core rejects is stopped by the existing filter before any tool runs`() {
        `when`(core.verify("Bearer expired")).thenThrow(HttpClientErrorException(HttpStatus.UNAUTHORIZED))

        assertEquals(401, toolCall("probe_whoami", "expired").statusCode())
    }

    @Test fun `the browser API chain is unchanged`() {
        assertEquals(401, send("/api/v1/works").statusCode())
        assertEquals(403, send("/api/v1/works", "POST", """{"title":"CSRF 없이"}""").statusCode())
    }
}
