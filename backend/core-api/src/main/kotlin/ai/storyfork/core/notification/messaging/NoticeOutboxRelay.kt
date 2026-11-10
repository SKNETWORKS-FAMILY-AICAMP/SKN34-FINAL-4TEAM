package ai.storyfork.core.notification.messaging

import ai.storyfork.core.notification.service.NoticeEventPublisher
import ai.storyfork.core.notification.service.NoticeOutboxService
import java.util.UUID
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

/**
 * Outbox의 대기 사건을 주기적으로 브로커에 보낸다. 같은 사건이 두 번 나가도 eventId가 같아 Core의 소비 쪽이 한 번만 반영한다.
 * 1차는 Core 한 대 기준이다. 여러 대로 늘리면 같은 행을 여러 대가 보낼 수 있으나 위 이유로 결과는 같고, 그때 행 잠금을 추가한다.
 * 메시지 본문·수신자는 로그에 남기지 않는다.
 */
@Component
class NoticeOutboxRelay(
    private val outbox: NoticeOutboxService,
    private val publisher: NoticeEventPublisher,
    @Value("\${app.notification.outbox.relay-enabled:true}") private val enabled: Boolean,
) {
    private val log = LoggerFactory.getLogger(NoticeOutboxRelay::class.java)

    @Scheduled(fixedDelayString = "\${app.notification.outbox.poll-interval:PT2S}")
    fun poll() {
        if (!enabled) return
        try { relayOnce() } catch (e: RuntimeException) { log.warn("notice outbox relay failed: {}", e.javaClass.simpleName) }
    }

    /**
     * 대기 사건을 오래된 순으로 보내고 보낸 건수를 반환한다. 발행이 실패하면(브로커 장애) 이번 주기를 멈추고
     * 행은 그대로 둬 다음 주기에 같은 eventId로 다시 보낸다. 시도 횟수 한도가 없어 장애가 길어도 사건이 버려지지 않는다.
     */
    fun relayOnce(): Int {
        var sent = 0
        for (message in outbox.pending()) {
            try {
                publisher.publish(message)
            } catch (e: Exception) {
                log.warn("notice outbox publish failed: eventId={} error={}", message.eventId, e.javaClass.simpleName)
                break
            }
            outbox.markSent(UUID.fromString(message.eventId))
            sent += 1
        }
        return sent
    }
}
