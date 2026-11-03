package ai.storyfork.core.auth.config

import ai.storyfork.core.auth.entity.AuthMember
import org.springframework.boot.persistence.autoconfigure.EntityScan
import org.springframework.context.annotation.Configuration
import org.springframework.data.jpa.repository.config.EnableJpaRepositories

@Configuration(proxyBeanMethods = false)
@EntityScan(basePackageClasses = [AuthMember::class])
@EnableJpaRepositories(basePackages = ["ai.storyfork.core.auth.repository"])
class AuthPersistenceConfig
