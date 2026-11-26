package ai.storyfork.core.notification.config

import java.time.Duration
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.sns.SnsClient

@Configuration
@ConditionalOnProperty(name = ["app.notification.push.enabled"], havingValue = "true")
class SnsPushConfig {
    @Bean(destroyMethod = "close")
    fun snsClient(@Value("\${app.notification.push.platform-arn}") platformArn: String): SnsClient {
        val arn = platformArn.split(':')
        require(arn.size == 6 && arn[0] == "arn" && arn[2] == "sns" && arn[3].isNotBlank() &&
            arn[5].startsWith("app/GCM/")) { "PUSH_SNS_PLATFORM_ARN must identify an SNS Android application" }
        return SnsClient.builder()
            .region(Region.of(arn[3]))
            .httpClientBuilder(UrlConnectionHttpClient.builder())
            .overrideConfiguration {
                it.apiCallTimeout(Duration.ofSeconds(15)).apiCallAttemptTimeout(Duration.ofSeconds(5))
            }
            .build()
    }
}
