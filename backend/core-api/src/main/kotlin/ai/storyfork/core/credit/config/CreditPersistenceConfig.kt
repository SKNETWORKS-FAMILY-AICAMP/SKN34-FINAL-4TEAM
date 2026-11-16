package ai.storyfork.core.credit.config

import ai.storyfork.core.credit.entity.CreditGrantEntity
import org.springframework.boot.persistence.autoconfigure.EntityScan
import org.springframework.context.annotation.Configuration
import org.springframework.data.jpa.repository.config.EnableJpaRepositories

/** Core 크레딧 Entity·Repository를 Auth와 같은 persistence unit에 추가 등록한다. */
@Configuration(proxyBeanMethods = false)
@EntityScan(basePackageClasses = [CreditGrantEntity::class])
@EnableJpaRepositories(basePackages = ["ai.storyfork.core.credit.repository"])
class CreditPersistenceConfig
