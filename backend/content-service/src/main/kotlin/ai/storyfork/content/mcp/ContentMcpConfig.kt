package ai.storyfork.content.mcp

import io.modelcontextprotocol.json.jackson3.JacksonMcpJsonMapper
import org.springframework.ai.mcp.server.common.autoconfigure.properties.McpServerStreamableHttpProperties
import org.springframework.ai.mcp.server.webmvc.transport.WebMvcStatelessServerTransport
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import tools.jackson.databind.json.JsonMapper

@Configuration(proxyBeanMethods = false)
class ContentMcpConfig {
    /**
     * Spring AI 기본 Stateless 전송과 같되 요청마다 호출자(검증된 회원)를 transport context에 싣는다.
     * 기본 전송은 `@ConditionalOnMissingBean`이라 이 빈이 있으면 물러나고, 라우터 함수는 이 빈으로 만들어진다.
     */
    @Bean
    fun contentMcpTransport(@Qualifier("mcpServerJsonMapper") mapper: JsonMapper, properties: McpServerStreamableHttpProperties): WebMvcStatelessServerTransport =
        WebMvcStatelessServerTransport.builder()
            .jsonMapper(JacksonMcpJsonMapper(mapper))
            .messageEndpoint(properties.mcpEndpoint)
            .contextExtractor { mcpCallerContext() }
            .build()
}
