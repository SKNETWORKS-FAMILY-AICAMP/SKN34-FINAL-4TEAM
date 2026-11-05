package ai.storyfork.core.notification.messaging

import ai.storyfork.core.notification.domain.NoticeEventType
import org.springframework.amqp.core.BindingBuilder
import org.springframework.amqp.core.Declarable
import org.springframework.amqp.core.Declarables
import org.springframework.amqp.core.DirectExchange
import org.springframework.amqp.core.QueueBuilder
import org.springframework.amqp.core.TopicExchange
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

/**
 * 알림 사건 교환기·큐·DLQ 선언. RabbitAdmin이 브로커 연결 시 없으면 만들고 이미 같은 설정이면 그대로 둔다.
 * 큐에는 NoticeEventType 목록의 routing key만 묶는다. 처리 못 한 메시지는 <queue>.dlq로 모인다.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = ["app.notification.events.enabled"], havingValue = "true")
class NoticeEventTopologyConfig {
    @Bean
    fun noticeEventDeclarables(
        @Value("\${app.notification.events.exchange}") exchangeName: String,
        @Value("\${app.notification.events.queue}") queueName: String,
    ): Declarables {
        val exchange = TopicExchange(exchangeName, true, false)
        val deadExchange = DirectExchange("$exchangeName.dlx", true, false)
        val queue = QueueBuilder.durable(queueName).deadLetterExchange(deadExchange.name).deadLetterRoutingKey(queueName).build()
        val deadQueue = QueueBuilder.durable("$queueName.dlq").build()
        val declarables = mutableListOf<Declarable>(exchange, deadExchange, queue, deadQueue)
        NoticeEventType.entries.forEach { declarables += BindingBuilder.bind(queue).to(exchange).with(it.code) }
        declarables += BindingBuilder.bind(deadQueue).to(deadExchange).with(queueName)
        return Declarables(declarables)
    }
}
