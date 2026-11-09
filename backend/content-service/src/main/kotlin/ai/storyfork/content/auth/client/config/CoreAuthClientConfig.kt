package ai.storyfork.content.auth.client.config

import ai.storyfork.content._common.helper.buildRestClient
import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.CoreMemberClient
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.client.RestClient
import org.springframework.web.client.support.RestClientAdapter
import org.springframework.web.service.invoker.HttpServiceProxyFactory

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(CoreAuthClientProperties::class)
class CoreAuthClientConfig {
    @Bean
    fun coreAuthClient(builder: RestClient.Builder, properties: CoreAuthClientProperties,
        @Value("\${CONTENT_CORE_AUTH_TOKEN:}") serviceToken: String): CoreAuthClient =
        proxy(CoreAuthClient::class.java, builder, properties, serviceToken)

    /** 회원 닉네임 조회도 인증 확인과 같은 Core 주소·서비스 자격·시간 제한·리다이렉트 거부를 쓴다. */
    @Bean
    fun coreMemberClient(builder: RestClient.Builder, properties: CoreAuthClientProperties,
        @Value("\${CONTENT_CORE_AUTH_TOKEN:}") serviceToken: String): CoreMemberClient =
        proxy(CoreMemberClient::class.java, builder, properties, serviceToken)

    private fun <T : Any> proxy(type: Class<T>, builder: RestClient.Builder, properties: CoreAuthClientProperties, serviceToken: String): T {
        require(serviceToken.length >= 32 && serviceToken.none { it == '\r' || it == '\n' }) {
            "CONTENT_CORE_AUTH_TOKEN must contain at least 32 characters without line breaks"
        }
        val client = buildRestClient(builder.defaultHeader("X-Content-Service-Token", serviceToken)
            .defaultStatusHandler({ it.is3xxRedirection }, { _, _ ->
                throw org.springframework.web.client.RestClientException("Unexpected verification redirect")
            }),
            properties.baseUrl, properties.connectTimeout, properties.readTimeout)
        return HttpServiceProxyFactory.builderFor(RestClientAdapter.create(client)).build().createClient(type)
    }
}
