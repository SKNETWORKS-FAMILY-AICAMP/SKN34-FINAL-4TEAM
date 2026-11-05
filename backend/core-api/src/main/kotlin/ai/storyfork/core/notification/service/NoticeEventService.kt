package ai.storyfork.core.notification.service

import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.notification.domain.NoticeEventType
import ai.storyfork.core.notification.repository.NoticeRepository
import ai.storyfork.core.notification.service.dto.NoticeCreateRequest
import ai.storyfork.core.notification.service.dto.NoticeEventMessage
import ai.storyfork.core.notification.service.dto.NoticeEventResult
import java.time.Instant
import java.util.UUID
import org.slf4j.LoggerFactory
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service

/**
 * 알림 사건 한 건을 검증해 알림함에 반영한다. 이 클래스는 트랜잭션을 열지 않는다:
 * 실제 저장은 NoticeService.create의 트랜잭션에서 하고, 유일 제약 위반(동시 중복)은 여기서 중복으로 해석한다.
 */
@Service
class NoticeEventService(
    private val notices: NoticeService,
    private val noticeRows: NoticeRepository,
    private val members: MemberRepository,
) {
    private val log = LoggerFactory.getLogger(NoticeEventService::class.java)

    /** 검증에 실패하면 InvalidNoticeEventException. 이미 반영한 사건·꺼진 분류·없는 회원은 알림 없이 정상 종료한다. */
    fun handle(message: NoticeEventMessage): NoticeEventResult {
        if (message.schemaVersion != 1) invalid("unsupported schemaVersion")
        val eventId = uuid(message.eventId, "eventId")
        val type = NoticeEventType.fromCode(message.type.orEmpty()) ?: invalid("unknown type")
        val recipientId = uuid(message.recipientId, "recipientId")
        try { Instant.parse(message.occurredAt.orEmpty()) } catch (_: RuntimeException) { invalid("occurredAt") }
        val target = message.target
        if (target?.type != type.targetType) invalid("target.type")
        val targetId = target.id?.takeIf { it.isNotBlank() && it.length <= 100 } ?: invalid("target.id")

        if (noticeRows.existsBySourceEventId(eventId)) return NoticeEventResult.DUPLICATE
        if (!members.existsById(recipientId)) {
            log.info("notice event dropped: unknown recipient eventId={}", eventId)
            return NoticeEventResult.DROPPED_UNKNOWN_MEMBER
        }
        return try {
            val created = notices.create(NoticeCreateRequest(recipientId, type.kind, type.summary, type.targetType, targetId, eventId))
            if (created == null) NoticeEventResult.SKIPPED_PREFERENCE else NoticeEventResult.CREATED
        } catch (e: DataIntegrityViolationException) {
            // 같은 사건이 동시에 도착해 다른 소비자가 먼저 저장한 경우만 중복이다. 그 외 제약 위반은 그대로 다시 던진다.
            if (noticeRows.existsBySourceEventId(eventId)) NoticeEventResult.DUPLICATE else throw e
        }
    }

    private fun uuid(value: String?, field: String): UUID =
        try { UUID.fromString(value.orEmpty()) } catch (_: IllegalArgumentException) { invalid(field) }

    private fun invalid(reason: String): Nothing = throw InvalidNoticeEventException("invalid notice event: $reason")
}
