package ai.storyfork.core.notification.messaging

import ai.storyfork.core.notification.service.InvalidNoticeEventException
import ai.storyfork.core.notification.service.NoticeEventService
import ai.storyfork.core.notification.service.dto.NoticeEventMessage
import org.slf4j.LoggerFactory
import org.springframework.amqp.AmqpRejectAndDontRequeueException
import org.springframework.amqp.core.Message
import org.springframework.amqp.rabbit.annotation.RabbitListener
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.stereotype.Component
import tools.jackson.databind.ObjectMapper

/**
 * 알림 사건 큐 소비자. 메시지 본문은 로그에 남기지 않는다.
 * 형식이 잘못된 메시지는 재시도 없이 DLQ로 보내고, 일시적 오류(DB 등)는 재시도 후 DLQ로 간다.
 */
@Component
@ConditionalOnProperty(name = ["app.notification.events.enabled"], havingValue = "true")
class NoticeEventListener(private val events: NoticeEventService, private val mapper: ObjectMapper) {
    private val log = LoggerFactory.getLogger(NoticeEventListener::class.java)

    @RabbitListener(queues = ["\${app.notification.events.queue}"])
    fun receive(message: Message) {
        val event = try {
            mapper.readValue(String(message.body, Charsets.UTF_8), NoticeEventMessage::class.java)
        } catch (e: RuntimeException) {
            log.warn("notice event rejected: malformed body")
            throw AmqpRejectAndDontRequeueException("malformed notice event", e)
        }
        try {
            val result = events.handle(event)
            log.info("notice event handled: eventId={} result={}", event.eventId, result)
        } catch (e: InvalidNoticeEventException) {
            log.warn("notice event rejected: {}", e.message)
            throw AmqpRejectAndDontRequeueException(e.message.orEmpty(), e)
        }
    }
}
