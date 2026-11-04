package ai.storyfork.content.auth.client.config

import ai.storyfork.content._common.helper.validateHttpBaseUrl
import ai.storyfork.content._common.helper.validatePositiveDuration
import java.net.URI
import java.time.Duration
import org.springframework.boot.context.properties.ConfigurationProperties

@ConfigurationProperties("app.core-auth")
data class CoreAuthClientProperties(val baseUrl: URI, val connectTimeout: Duration, val readTimeout: Duration) {
    init {
        validateHttpBaseUrl(baseUrl, "app.core-auth.base-url")
        validatePositiveDuration(connectTimeout, "app.core-auth.connect-timeout")
        validatePositiveDuration(readTimeout, "app.core-auth.read-timeout")
    }
}
