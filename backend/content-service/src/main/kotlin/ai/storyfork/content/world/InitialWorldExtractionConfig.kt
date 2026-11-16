package ai.storyfork.content.world

import ai.storyfork.content._common.ai_config.AiServiceClientProperties
import ai.storyfork.content._common.helper.buildRestClient
import ai.storyfork.content.world.client.InitialWorldExtractionClient
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.client.RestClient
import java.time.Duration

@Configuration(proxyBeanMethods=false)
class InitialWorldExtractionConfig {
    @Bean fun initialWorldAnalysisClock():java.time.Clock=java.time.Clock.systemUTC()
    @Bean fun initialWorldExtractionClient(builder:RestClient.Builder,properties:AiServiceClientProperties,
        @Value("\${INTERNAL_TOKEN:}") token:String)=InitialWorldExtractionClient(
        buildRestClient(builder,properties.baseUrl,properties.connectTimeout,Duration.ofSeconds(75)),token)
}
