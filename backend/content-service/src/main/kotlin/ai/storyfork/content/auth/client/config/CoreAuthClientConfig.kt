package ai.storyfork.content.auth.client.config

import ai.storyfork.content._common.helper.buildRestClient
import ai.storyfork.content.auth.client.CoreAuthClient
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.client.RestClient
import org.springframework.web.client.support.RestClientAdapter
import org.springframework.web.service.invoker.HttpServiceProxyFactory

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = ["app.content.enabled"], havingValue = "true")
@EnableConfigurationProperties(CoreAuthClientProperties::class)
class CoreAuthClientConfig {
    @Bean
    fun coreAuthClient(builder: RestClient.Builder, properties: CoreAuthClientProperties,
        @Value("\${CONTENT_CORE_AUTH_TOKEN:}") serviceToken: String): CoreAuthClient {
        require(serviceToken.length >= 32 && serviceToken.none { it == '\r' || it == '\n' }) {
            "CONTENT_CORE_AUTH_TOKEN must contain at least 32 characters without line breaks"
        }
        val client = buildRestClient(builder.defaultHeader("X-Content-Service-Token", serviceToken)
            .defaultStatusHandler({ it.is3xxRedirection }, { _, _ ->
                throw org.springframework.web.client.RestClientException("Unexpected verification redirect")
            }),
            properties.baseUrl, properties.connectTimeout, properties.readTimeout)
        return HttpServiceProxyFactory.builderFor(RestClientAdapter.create(client)).build().createClient(CoreAuthClient::class.java)
    }
}
