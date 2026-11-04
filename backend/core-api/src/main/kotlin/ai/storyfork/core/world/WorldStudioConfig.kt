package ai.storyfork.core.world

import ai.storyfork.core.world.entity.StudioWorld
import org.springframework.boot.persistence.autoconfigure.EntityScan
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Configuration
import org.springframework.data.jpa.repository.config.EnableJpaRepositories

@Configuration(proxyBeanMethods=false)
@ConditionalOnProperty(name=["app.worldstudio.enabled"],havingValue="true")
// AuthPersistenceConfig의 EntityScan과 합쳐 Boot 기본 persistence unit을 사용한다.
@EntityScan(basePackageClasses=[StudioWorld::class])
@EnableJpaRepositories(basePackages=["ai.storyfork.core.world.repository"])
class WorldStudioConfig
