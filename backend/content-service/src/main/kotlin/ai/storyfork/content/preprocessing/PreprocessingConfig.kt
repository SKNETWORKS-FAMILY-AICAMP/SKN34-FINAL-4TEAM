package ai.storyfork.content.preprocessing

import ai.storyfork.content._common.ai_config.AiServiceClientProperties
import ai.storyfork.content._common.helper.buildRestClient
import ai.storyfork.content.preprocessing.client.PreprocessingAiClient
import java.time.Duration
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.client.RestClient

/** 전처리 접수 클라이언트(#343). AI는 접수만 하고 바로 202를 돌려주므로 읽기 제한을 짧게 둔다. */
@Configuration(proxyBeanMethods = false)
class PreprocessingConfig {
    @Bean fun preprocessingAiClient(builder: RestClient.Builder, properties: AiServiceClientProperties,
        @Value("\${INTERNAL_TOKEN:}") token: String) = PreprocessingAiClient(
        buildRestClient(builder, properties.baseUrl, properties.connectTimeout, Duration.ofSeconds(10)), token)
}
