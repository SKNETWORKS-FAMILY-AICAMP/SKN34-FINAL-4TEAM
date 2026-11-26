package ai.storyfork.core.notification

import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.notification.domain.NoticeDetail
import ai.storyfork.core.notification.domain.NoticeEventType
import ai.storyfork.core.notification.domain.NoticeKind
import ai.storyfork.core.notification.repository.NoticeRepository
import ai.storyfork.core.notification.service.InvalidNoticeEventException
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
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.mock
import org.mockito.Mockito.mockingDetails
import org.mockito.Mockito.`when`

/** 새 사건 종류가 알림으로 바뀌는 길을 DB·브로커 없이 확인한다. 검증 위반·저장·중복·동시성은 NoticeEventIntegrationTest가 맡는다. */
class NoticeEventServiceTest {
    private val me = UUID.randomUUID()
    private val notices = mock(NoticeService::class.java)
    private val members = mock(MemberRepository::class.java)
    private val events = NoticeEventService(notices, mock(NoticeRepository::class.java), members)

    private fun message(type: String, targetType: String, eventId: UUID = UUID.randomUUID(), detail: NoticeDetail? = null) = NoticeEventMessage(
        schemaVersion = 1, eventId = eventId.toString(), type = type, occurredAt = Instant.now().toString(),
        recipientId = me.toString(), target = NoticeEventTarget(targetType, "t-1"), detail = detail,
    )

    /** 사건 하나를 처리하고 알림 생성에 넘긴 요청을 돌려준다. */
    private fun created(message: NoticeEventMessage): NoticeCreateRequest {
        `when`(members.existsById(me)).thenReturn(true)
        `when`(notices.create(ArgumentMatchers.any(NoticeCreateRequest::class.java) ?: NoticeCreateRequest(me, NoticeKind.READING, "x")))
            .thenReturn(NoticeResponse(UUID.randomUUID().toString(), "x", "x", null, null, Instant.now(), false))
        events.handle(message)
        return mockingDetails(notices).invocations.last { it.method.name == "create" }.arguments.single() as NoticeCreateRequest
    }

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

    @Test
    fun `detail turns into a specific summary, the episode to open and the phrase a bundle reuses`() {
        val request = created(message("content.mcp.work-changed", "work", detail = NoticeDetail("별의 숲", 3, "원고")))
        assertEquals("AI가 MCP로 「별의 숲」 3화 원고를 수정했어요", request.summary)
        assertEquals(3, request.targetEpisode)
        assertEquals("「별의 숲」 3화 원고", request.bundleSubject)
        assertEquals(listOf("work", "t-1"), listOf(request.targetType, request.targetId))
    }

    @Test
    fun `an event without detail keeps the fixed summary and no episode`() {
        val request = created(message("content.mcp.work-changed", "work"))
        assertEquals("AI가 MCP로 작품을 수정했어요", request.summary)
        assertEquals(null, request.targetEpisode)
        assertEquals(null, request.bundleSubject)
    }

    @Test
    fun `an episode number below one breaks the contract`() {
        `when`(members.existsById(me)).thenReturn(true)
        listOf(0, -1).forEach { ep ->
            assertThrows(InvalidNoticeEventException::class.java) { events.handle(message("content.operator.work-restricted", "work", detail = NoticeDetail("별의 숲", ep))) }
        }
    }

    @Test
    fun `a world event keeps no episode even if one is sent`() {
        assertEquals(null, created(message("content.mcp.world-changed", "world", detail = NoticeDetail("용의 땅", 2))).targetEpisode)
    }
}
