package ai.storyfork.content.proposal.config

import ai.storyfork.content._common.ai_config.AiServiceClientProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Configuration

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(AiServiceClientProperties::class)
class AiServicePropertiesConfig
