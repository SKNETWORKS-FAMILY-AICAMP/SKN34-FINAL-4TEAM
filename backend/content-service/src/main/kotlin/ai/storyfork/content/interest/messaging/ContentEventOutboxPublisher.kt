package ai.storyfork.content.interest.messaging

import ai.storyfork.content.interest.entity.ContentEventOutboxEntity
import ai.storyfork.content.interest.repository.ContentEventOutboxRepository
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.slf4j.LoggerFactory
import org.springframework.amqp.AmqpException
import org.springframework.amqp.core.AmqpTemplate
import org.springframework.amqp.core.Message
import org.springframework.amqp.core.MessageBuilder
import org.springframework.amqp.core.MessageProperties
import org.springframework.beans.factory.annotation.Value
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import tools.jackson.databind.json.JsonMapper

/**
 * outbox에서 아직 보내지 않은 알림 사건을 [알림 사건 계약](docs/notification-event-contract.md) 형식으로 교환기에 보낸다(단일 인스턴스 스케줄 폴링).
 * 보낸 행만 published_at을 채우고, 실패하면 이번 주기를 멈춰 다음 주기에 같은 eventId로 다시 보낸다(Core가 중복을 거른다).
 * 본문에는 개인 정보·원문을 싣지 않고 로그에도 남기지 않는다.
 */
@Component
class ContentEventOutboxPublisher(
    private val outbox: ContentEventOutboxRepository,
    private val amqp: AmqpTemplate,
    private val mapper: JsonMapper,
    @Value("\${app.content-events.exchange}") private val exchange: String,
) {
    private val log = LoggerFactory.getLogger(ContentEventOutboxPublisher::class.java)

    @Scheduled(fixedDelayString = "\${app.content-events.publish-delay}")
    fun publishPending() {
        for(row in outbox.findTop100ByPublishedAtIsNullOrderByOccurredAtAscIdAsc()) {
            try {
                amqp.send(exchange,row.type,message(row))
            } catch(error: AmqpException) {
                log.warn("content event publish failed, retrying next cycle: eventId={} cause={}",row.id,error.javaClass.simpleName)
                return
            }
            row.publishedAt=Instant.now().truncatedTo(ChronoUnit.MICROS)
            outbox.save(row)
        }
    }

    private fun message(row: ContentEventOutboxEntity): Message {
        val body=ContentEventMessage(1,row.id.toString(),row.type,row.occurredAt.toString(),row.recipientId,ContentEventMessage.Target(row.targetType,row.targetId))
        return MessageBuilder.withBody(mapper.writeValueAsBytes(body)).setContentType(MessageProperties.CONTENT_TYPE_JSON).setMessageId(row.id.toString()).build()
    }
}

/** 알림 사건 계약(schemaVersion 1)의 메시지 본문. */
internal data class ContentEventMessage(val schemaVersion: Int, val eventId: String, val type: String, val occurredAt: String, val recipientId: String, val target: Target) {
    data class Target(val type: String, val id: String)
}
