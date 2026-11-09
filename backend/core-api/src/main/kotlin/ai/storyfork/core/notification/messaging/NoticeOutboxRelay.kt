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
    @Value("\${app.notification.outbox.batch-size:50}") private val batchSize: Int,
) {
    private val log = LoggerFactory.getLogger(NoticeOutboxRelay::class.java)

    @Scheduled(fixedDelayString = "\${app.notification.outbox.poll-interval:PT2S}")
    fun poll() {
        if (!enabled) return
        try { relayOnce() } catch (e: RuntimeException) { log.warn("notice outbox relay failed: {}", e.javaClass.simpleName) }
    }

    /** 지금 보낼 차례인 사건을 한 번 처리하고 보낸 건수를 반환한다. 한 건이 실패해도 나머지는 계속 보낸다. */
    fun relayOnce(): Int {
        var sent = 0
        for (message in outbox.due(batchSize)) {
            val id = UUID.fromString(message.eventId)
            try {
                publisher.publish(message)
            } catch (e: Exception) {
                log.warn("notice outbox publish failed: eventId={} error={}", id, e.javaClass.simpleName)
                outbox.markFailed(id, e.javaClass.simpleName)
                continue
            }
            outbox.markSent(id)
            sent += 1
        }
        return sent
    }
}
