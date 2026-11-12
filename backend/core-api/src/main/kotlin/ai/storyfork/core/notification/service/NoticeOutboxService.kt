package ai.storyfork.core.notification.service

import ai.storyfork.core.notification.domain.NoticeEventType
import ai.storyfork.core.notification.entity.NoticeOutboxEntity
import ai.storyfork.core.notification.repository.NoticeOutboxRepository
import ai.storyfork.core.notification.service.dto.NoticeEventMessage
import ai.storyfork.core.notification.service.dto.NoticeEventTarget
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional

/**
 * 알림 사건 Outbox. 사건을 만드는 쪽은 enqueue 한 줄만 호출하면 되고, 브로커로 보내는 일은 NoticeOutboxRelay가 맡는다.
 * 각 메서드는 짧은 트랜잭션이라 브로커 호출 중에는 DB 트랜잭션을 잡고 있지 않는다.
 */
@Service
class NoticeOutboxService(private val outbox: NoticeOutboxRepository) {
    /**
     * 업무 변경과 같은 트랜잭션에서 사건을 기록한다. 열린 트랜잭션이 없으면 예외라 "변경은 됐는데 사건이 사라지는" 호출을 막는다.
     * 반환값이 계약의 eventId이며 이후 재전송에도 같은 값이 쓰인다.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    fun enqueue(type: NoticeEventType, recipientId: UUID, targetId: String): UUID {
        val id = UUID.randomUUID()
        enqueueOnce(type, recipientId, targetId, id)
        return id
    }

    /**
     * [enqueue]와 같되 사건 id를 호출하는 쪽이 정한다. 같은 id가 이미 기록돼 있으면 새로 기록하지 않고 false를 반환한다.
     * 정기 작업이 같은 사건을 여러 번 만들 수 있을 때(예: 크레딧 소멸 예정) 알림이 한 번만 생기게 하려고 쓴다.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    fun enqueueOnce(type: NoticeEventType, recipientId: UUID, targetId: String, eventId: UUID): Boolean {
        if (outbox.existsById(eventId)) return false
        outbox.save(NoticeOutboxEntity(
            id = eventId, eventType = type.code, recipientId = recipientId,
            targetType = type.targetType, targetId = targetId, occurredAt = Instant.now().truncatedTo(ChronoUnit.MICROS),
        ))
        return true
    }

    /** 아직 보내지 않은 사건을 오래된 순으로 최대 50개, 계약 메시지로 바꿔 반환한다. */
    @Transactional(readOnly = true)
    fun pending(): List<NoticeEventMessage> =
        outbox.findTop50BySentAtIsNullOrderByOccurredAtAscIdAsc().map {
            NoticeEventMessage(
                schemaVersion = 1, eventId = it.id.toString(), type = it.eventType, occurredAt = it.occurredAt.toString(),
                recipientId = it.recipientId.toString(), target = NoticeEventTarget(it.targetType, it.targetId),
            )
        }

    /** 브로커가 받은 사건을 전송 완료로 표시한다. */
    @Transactional
    fun markSent(eventId: UUID) {
        outbox.findById(eventId).ifPresent { it.sentAt = Instant.now() }
    }
}
