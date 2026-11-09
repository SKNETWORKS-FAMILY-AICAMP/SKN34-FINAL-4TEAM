package ai.storyfork.core.notification.config

import org.springframework.context.annotation.Configuration
import org.springframework.scheduling.annotation.EnableScheduling

/** 알림 Outbox 발행기의 주기 실행을 켠다. 발행기 자체는 app.notification.outbox.relay-enabled로 끌 수 있다. */
@Configuration(proxyBeanMethods = false)
@EnableScheduling
class NoticeOutboxConfig
