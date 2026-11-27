package ai.storyfork.core.notification.config

import java.time.Duration
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials
import software.amazon.awssdk.auth.credentials.AwsSessionCredentials
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.sns.SnsClient

@Configuration
@ConditionalOnProperty(name = ["app.notification.push.enabled"], havingValue = "true")
class SnsPushConfig {
    @Bean(destroyMethod = "close")
    fun snsClient(
        @Value("\${app.notification.push.platform-arn}") platformArn: String,
        @Value("\${app.notification.push.access-key-id}") access: String,
        @Value("\${app.notification.push.secret-access-key}") secret: String,
        @Value("\${app.notification.push.session-token}") token: String,
    ): SnsClient {
        val arn = platformArn.split(':')
        require(arn.size == 6 && arn[0] == "arn" && arn[2] == "sns" && arn[3].isNotBlank() &&
            arn[5].startsWith("app/GCM/")) { "PUSH_SNS_PLATFORM_ARN must identify an SNS Android application" }
        require(access.isBlank() == secret.isBlank() && (token.isBlank() || access.isNotBlank())) {
            "PUSH_SNS credentials must be provided together"
        }
        val builder = SnsClient.builder()
            .region(Region.of(arn[3]))
            .httpClientBuilder(UrlConnectionHttpClient.builder())
            .overrideConfiguration {
                it.apiCallTimeout(Duration.ofSeconds(15)).apiCallAttemptTimeout(Duration.ofSeconds(5))
            }
        if (access.isNotBlank()) {
            val credentials = if (token.isBlank()) AwsBasicCredentials.create(access, secret)
            else AwsSessionCredentials.create(access, secret, token)
            builder.credentialsProvider(StaticCredentialsProvider.create(credentials))
        }
        return builder.build()
    }
}
