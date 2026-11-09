package ai.storyfork.operations.event

import ai.storyfork.operations._common.service.dto.PageResponse
import ai.storyfork.operations.event.controller.EventController
import ai.storyfork.operations.event.service.EventService
import ai.storyfork.operations.event.service.dto.EventRequest
import ai.storyfork.operations.event.service.dto.EventResponse
import java.net.URI
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.mockito.Mock
import org.mockito.Mockito.*
import org.mockito.junit.jupiter.MockitoExtension
import org.springframework.data.domain.PageRequest
import org.springframework.http.HttpStatus

/** Spring context나 HTTP 서버 없이 리소스별 응답 계약을 확인한다. */
@ExtendWith(MockitoExtension::class)
class EventControllerTest {
    @Mock lateinit var service: EventService
    private val controller get() = EventController(service)
    private val id = UUID.randomUUID()
    private val time = Instant.parse("2026-11-05T01:00:00Z")
    private val event get() = EventResponse(id, "제목", "본문", null, null, time, time)

    @Test
    fun `create returns 201 with an event detail Location and DTO`() {
        val request = EventRequest("제목", "본문")
        val saved = event
        `when`(service.create(request)).thenReturn(saved)
        val response = controller.create(request)
        assertEquals(HttpStatus.CREATED, response.statusCode)
        assertEquals(URI.create("/api/v1/operations/events/$id"), response.headers.location)
        assertEquals(saved, response.body)
    }

    @Test
    fun `list returns the explicit paged DTO`() {
        val pageable = PageRequest.of(0, 20)
        val saved = PageResponse(listOf(event), 0, 20, 1, 1)
        `when`(service.list(pageable)).thenReturn(saved)
        assertEquals(saved, controller.list(pageable))
    }

    @Test
    fun `detail returns the service DTO`() {
        val saved = event
        `when`(service.read(id)).thenReturn(saved)
        assertEquals(saved, controller.read(id))
    }

    @Test
    fun `full update returns the updated service DTO`() {
        val request = EventRequest("수정", "수정 본문", time, time.plusSeconds(3600))
        val saved = event.copy(title = request.title, body = request.body, startsAt = request.startsAt, endsAt = request.endsAt)
        `when`(service.update(id, request)).thenReturn(saved)
        assertEquals(saved, controller.update(id, request))
    }

    @Test
    fun `delete delegates once and returns 204 without a body`() {
        val response = controller.delete(id)
        assertEquals(HttpStatus.NO_CONTENT, response.statusCode)
        assertNull(response.body)
        verify(service).delete(id)
        verifyNoMoreInteractions(service)
    }
}
