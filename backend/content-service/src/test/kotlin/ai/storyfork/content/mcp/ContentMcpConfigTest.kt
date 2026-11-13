package ai.storyfork.content.mcp

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.ai.mcp.server.common.autoconfigure.McpServerJsonMapperAutoConfiguration
import org.springframework.ai.mcp.server.webmvc.autoconfigure.McpServerStatelessWebMvcAutoConfiguration
import org.springframework.ai.mcp.server.webmvc.transport.WebMvcStatelessServerTransport
import org.springframework.boot.autoconfigure.AutoConfigurations
import org.springframework.boot.test.context.assertj.AssertableApplicationContext
import org.springframework.boot.test.context.runner.ApplicationContextRunner

/**
 * [ContentMcpConfig]의 전송 빈은 Spring AI 자동 설정이 만드는 JSON 매퍼·속성 빈을 주입받는다. 그 자동 설정은
 * `spring.ai.mcp.server.enabled=false`이면 빈을 등록하지 않으므로 우리 전송 빈도 같이 빠져야 서비스가 뜬다.
 * 실제 자동 설정(JSON 매퍼·Stateless WebMvc)만 함께 올린 가벼운 컨텍스트로 두 쪽의 활성 조건이 맞는지 확인한다(서버·도구·DB 없음).
 */
class ContentMcpConfigTest {
    private val runner = ApplicationContextRunner()
        .withConfiguration(AutoConfigurations.of(McpServerJsonMapperAutoConfiguration::class.java, McpServerStatelessWebMvcAutoConfiguration::class.java))
        .withUserConfiguration(ContentMcpConfig::class.java)
        .withPropertyValues("spring.ai.mcp.server.protocol=STATELESS") // application.properties와 같은 값이다.

    private fun transports(context: AssertableApplicationContext) =
        context.getBeanNamesForType(WebMvcStatelessServerTransport::class.java).toList()

    @Test fun `by default the caller-aware transport replaces the stock stateless transport`() {
        runner.run { context ->
            assertNull(context.startupFailure)
            assertEquals(listOf("contentMcpTransport"), transports(context))
        }
    }

    @Test fun `disabling the MCP server leaves no transport and the service still starts`() {
        runner.withPropertyValues("spring.ai.mcp.server.enabled=false").run { context ->
            assertNull(context.startupFailure)
            assertEquals(emptyList<String>(), transports(context))
        }
    }
}
