package ai.storyfork.core.notification

import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.notification.domain.NoticeEventType
import ai.storyfork.core.notification.repository.NoticeRepository
import ai.storyfork.core.notification.service.NoticeEventService
import ai.storyfork.core.notification.service.NoticeService
import ai.storyfork.core.notification.service.dto.NoticeCreateRequest
import ai.storyfork.core.notification.service.dto.NoticeEventMessage
import ai.storyfork.core.notification.service.dto.NoticeEventResult
import ai.storyfork.core.notification.service.dto.NoticeEventTarget
import ai.storyfork.core.notification.service.dto.NoticeResponse
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`

/** 새 사건 종류가 알림으로 바뀌는 길을 DB·브로커 없이 확인한다. 검증 위반·저장·중복·동시성은 NoticeEventIntegrationTest가 맡는다. */
class NoticeEventServiceTest {
    private val me = UUID.randomUUID()
    private val notices = mock(NoticeService::class.java)
    private val members = mock(MemberRepository::class.java)
    private val events = NoticeEventService(notices, mock(NoticeRepository::class.java), members)

    private fun message(type: String, targetType: String, eventId: UUID = UUID.randomUUID()) = NoticeEventMessage(
        schemaVersion = 1, eventId = eventId.toString(), type = type, occurredAt = Instant.now().toString(),
        recipientId = me.toString(), target = NoticeEventTarget(targetType, "t-1"),
    )

    @Test
    fun `mcp and operator events are turned into notices of their own kind, summary and target`() {
        `when`(members.existsById(me)).thenReturn(true)
        listOf(
            "content.mcp.world-changed" to "world", "content.mcp.work-changed" to "work",
            "content.operator.work-restricted" to "work", "content.operator.work-unrestricted" to "work",
            "content.operator.comment-hidden" to "work", "content.operator.comment-restored" to "work",
        ).forEach { (code, targetType) ->
            val type = requireNotNull(NoticeEventType.fromCode(code)) { "unknown type $code" }
            val eventId = UUID.randomUUID()
            val expected = NoticeCreateRequest(me, type.kind, type.summary, targetType, "t-1", eventId)
            `when`(notices.create(expected)).thenReturn(NoticeResponse(UUID.randomUUID().toString(), type.kind.code, type.summary, targetType, "t-1", Instant.now(), false))
            assertEquals(NoticeEventResult.CREATED, events.handle(message(code, targetType, eventId)), code)
        }
    }
}
