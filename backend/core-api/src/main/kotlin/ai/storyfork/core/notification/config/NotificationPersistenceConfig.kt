package ai.storyfork.core.notification.config

import ai.storyfork.core.notification.entity.NoticeEntity
import org.springframework.boot.persistence.autoconfigure.EntityScan
import org.springframework.context.annotation.Configuration
import org.springframework.data.jpa.repository.config.EnableJpaRepositories
import org.springframework.scheduling.annotation.EnableScheduling

/** Core 알림함 Entity·Repository를 Auth와 같은 persistence unit에 추가 등록하고, 알림 Outbox 발행기의 주기 실행을 켠다. */
@Configuration(proxyBeanMethods = false)
@EntityScan(basePackageClasses = [NoticeEntity::class])
@EnableJpaRepositories(basePackages = ["ai.storyfork.core.notification.repository"])
@EnableScheduling
class NotificationPersistenceConfig
