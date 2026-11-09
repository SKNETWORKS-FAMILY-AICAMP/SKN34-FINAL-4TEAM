package ai.storyfork.operations.event

import ai.storyfork.operations.event.controller.AdminEventController
import ai.storyfork.operations.event.service.AdminEventService
import ai.storyfork.operations.event.service.dto.EventListResponse
import ai.storyfork.operations.event.service.dto.EventRequest
import ai.storyfork.operations.event.service.dto.EventResponse
import ai.storyfork.operations.security.OperationsMember
import java.net.URI
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus

/** Spring context나 HTTP 서버 없이 관리자 이벤트 응답 계약과 인증 회원 전달을 확인한다. */
class AdminEventControllerTest {
    private val service = mock(AdminEventService::class.java)
    private val controller = AdminEventController(service)
    private val member = OperationsMember(UUID.randomUUID(), true)
    private val id = UUID.randomUUID()
    private val time = Instant.parse("2026-11-05T01:00:00Z")
    private val event = EventResponse(id, "제목", "본문", null, null, time, time)

    @Test
    fun `create returns 201 with the admin Location and DTO`() {
        val request = EventRequest("제목", "본문")
        `when`(service.create(member, request)).thenReturn(event)

        val response = controller.create(member, request)

        assertEquals(HttpStatus.CREATED, response.statusCode)
        assertEquals(URI.create("/api/v1/operations/admin/events/$id"), response.headers.location)
        assertEquals(event, response.body)
    }

    @Test
    fun `list detail and update pass the authenticated member and return the service DTOs`() {
        val page = EventListResponse(listOf(event), 0, 100, 1, 1)
        val request = EventRequest("수정", "수정 본문", time, time.plusSeconds(3600))
        val updated = event.copy(title = request.title, body = request.body, startsAt = request.startsAt, endsAt = request.endsAt)
        `when`(service.list(member)).thenReturn(page)
        `when`(service.read(member, id)).thenReturn(event)
        `when`(service.update(member, id, request)).thenReturn(updated)

        assertEquals(page, controller.list(member))
        assertEquals(event, controller.read(member, id))
        assertEquals(updated, controller.update(member, id, request))
    }

    @Test
    fun `delete passes the member once and returns 204 without a body`() {
        val response = controller.delete(member, id)

        assertEquals(HttpStatus.NO_CONTENT, response.statusCode)
        assertNull(response.body)
        verify(service).delete(member, id)
        verifyNoMoreInteractions(service)
    }
}
