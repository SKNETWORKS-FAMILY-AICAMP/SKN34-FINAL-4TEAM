package ai.storyfork.content.work

import ai.storyfork.content._common.ai_config.AiServiceClientProperties
import ai.storyfork.content._common.helper.buildRestClient
import ai.storyfork.content.work.client.WorkTagSuggestionClient
import java.time.Duration
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.client.RestClient

/** 장르·키워드 추천 클라이언트(#372). AI 서비스 모델 호출 timeout(30초)보다 조금 길게 기다린다. */
@Configuration(proxyBeanMethods = false)
class WorkTagSuggestionConfig {
    @Bean fun workTagSuggestionClient(builder: RestClient.Builder, properties: AiServiceClientProperties,
        @Value("\${INTERNAL_TOKEN:}") token: String) = WorkTagSuggestionClient(
        buildRestClient(builder, properties.baseUrl, properties.connectTimeout, Duration.ofSeconds(40)), token)
}
