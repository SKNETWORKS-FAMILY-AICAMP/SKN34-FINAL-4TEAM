package ai.storyfork.core.proposal.config

import ai.storyfork.core.proposal.client.GenerationClient
import ai.storyfork.core._common.ai_config.AiServiceClientProperties
import ai.storyfork.core._common.helper.*
import java.time.Duration
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.client.RestClient

@Configuration(proxyBeanMethods=false)
@ConditionalOnProperty(name=["app.content.enabled"],havingValue="true")
class GenerationClientConfig {
    @Bean fun generationClient(builder: RestClient.Builder, properties: AiServiceClientProperties,
        @Value("\${AI_GENERATION_READ_TIMEOUT:75s}") timeout: Duration,
        @Value("\${INTERNAL_TOKEN:}") token: String): GenerationClient {
        validatePositiveDuration(timeout,"AI_GENERATION_READ_TIMEOUT")
        return GenerationClient(buildRestClient(builder,properties.baseUrl,properties.connectTimeout,timeout),token)
    }
}
