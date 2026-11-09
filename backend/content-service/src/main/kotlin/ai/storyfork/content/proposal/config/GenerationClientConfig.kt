package ai.storyfork.content.proposal.config

import ai.storyfork.content.proposal.client.GenerationClient
import ai.storyfork.content._common.ai_config.AiServiceClientProperties
import ai.storyfork.content._common.helper.*
import java.time.Duration
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.client.RestClient

@Configuration(proxyBeanMethods=false)
class GenerationClientConfig {
    @Bean fun aiRunClient(builder: RestClient.Builder,properties: AiServiceClientProperties,
        @Value("\${INTERNAL_TOKEN:}") token: String) = ai.storyfork.content.proposal.client.AiRunClient(
            buildRestClient(builder,properties.baseUrl,properties.connectTimeout,properties.readTimeout),token)

    @Bean fun generationClient(builder: RestClient.Builder, properties: AiServiceClientProperties,
        @Value("\${AI_GENERATION_READ_TIMEOUT:75s}") timeout: Duration,
        @Value("\${INTERNAL_TOKEN:}") token: String): GenerationClient {
        validatePositiveDuration(timeout,"AI_GENERATION_READ_TIMEOUT")
        return GenerationClient(buildRestClient(builder,properties.baseUrl,properties.connectTimeout,timeout),token)
    }
}
