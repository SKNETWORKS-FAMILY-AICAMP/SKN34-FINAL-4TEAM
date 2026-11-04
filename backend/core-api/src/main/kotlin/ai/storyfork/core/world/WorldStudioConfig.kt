package ai.storyfork.core.world

import ai.storyfork.core.world.studio.entity.StudioWorld
import org.springframework.boot.persistence.autoconfigure.EntityScan
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Configuration
import org.springframework.data.jpa.repository.config.EnableJpaRepositories

@Configuration(proxyBeanMethods=false)
@ConditionalOnProperty(name=["app.worldstudio.enabled"],havingValue="true")
// Core 기본 EntityScan 등록을 공유하고 별도 persistence unit은 만들지 않는다.
@EntityScan(basePackageClasses=[StudioWorld::class])
@EnableJpaRepositories(basePackages=["ai.storyfork.core.world.studio.repository"])
class WorldStudioConfig
