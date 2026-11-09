package ai.storyfork.content.interest.messaging

import org.springframework.amqp.core.TopicExchange
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.scheduling.annotation.EnableScheduling

/**
 * 알림 사건 발행을 위해 스케줄링을 켜고, Core와 같은 설정(topic, durable)의 교환기를 선언해 교환기가 없는 브로커에 보내 사건이 사라지는 일을 막는다.
 * 큐·DLQ와 바인딩은 소비자인 Core가 선언한다. RabbitAdmin은 브로커 연결 시 같은 설정이면 그대로 두므로 선언 순서와 무관하다.
 */
@Configuration(proxyBeanMethods = false)
@EnableScheduling
class ContentEventsConfig {
    @Bean
    fun storyforkEventsExchange(@Value("\${app.content-events.exchange}") name: String) = TopicExchange(name,true,false)
}
