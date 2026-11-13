package ai.storyfork.content.writingai.config

import ai.storyfork.content._common.ai_config.AiServiceClientProperties
import ai.storyfork.content._common.helper.buildRestClient
import ai.storyfork.content.context.service.QaScopeGrants
import ai.storyfork.content.context.service.QaScopeService
import ai.storyfork.content.writingai.client.WritingAiClient
import ai.storyfork.content.writingai.service.WritingAiService
import java.time.Duration
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.client.RestClient

@Configuration(proxyBeanMethods=false)
internal class WritingAiConfig {
    // 집필 지원 작업 기준(UC-21) 3분 안에 Router·Agent·검색 단계가 끝나야 한다.
    @Bean
    fun writingAiService(scopes: QaScopeService, grants: QaScopeGrants, builder: RestClient.Builder,
                         ai: AiServiceClientProperties, @Value("\${INTERNAL_TOKEN:}") token: String) =
        WritingAiService(scopes, grants,
            WritingAiClient(buildRestClient(builder.clone(), ai.baseUrl, ai.connectTimeout, Duration.ofMinutes(3)), token))
}
