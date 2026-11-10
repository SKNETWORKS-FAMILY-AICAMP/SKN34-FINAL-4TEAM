package ai.storyfork.operations.event

import ai.storyfork.operations._common.service.dto.PageResponse
import ai.storyfork.operations.event.service.AdminEventService
import ai.storyfork.operations.event.service.EventService
import ai.storyfork.operations.event.service.dto.EventRequest
import ai.storyfork.operations.event.service.dto.EventResponse
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.security.OperationsMember
import jakarta.validation.ConstraintViolationException
import jakarta.validation.Validation
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.data.domain.PageRequest
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** 권한 확인이 이벤트 조회·검증보다 먼저인지와 기존 EventService 위임만 확인한다. Spring context·DB 없음. */
class AdminEventServiceTest {
    private val events = mock(EventService::class.java)
    private val permissions = mock(AdminPermissionRepository::class.java)
    private val service = AdminEventService(events, permissions, Validation.buildDefaultValidatorFactory().validator)

    private val admin = OperationsMember(UUID.randomUUID(), true)
    private val operatorWithoutEvents = OperationsMember(UUID.randomUUID(), true)
    private val staleGrant = OperationsMember(UUID.randomUUID(), false)
    private val id = UUID.randomUUID()
    private val time = Instant.parse("2026-11-05T01:00:00Z")
    private val request = EventRequest("제목", "본문", time, time.plusSeconds(3600))
    private val event = EventResponse(id, "제목", "본문", time, time.plusSeconds(3600), time, time)

    private fun givenEventsPermission() {
        `when`(permissions.existsByMemberIdAndPermission(admin.memberId, "events")).thenReturn(true)
        // 운영자가 아니면 남은 권한 행이 있어도 거절돼야 한다.
        `when`(permissions.existsByMemberIdAndPermission(staleGrant.memberId, "events")).thenReturn(true)
        // 다른 업무 권한은 events를 대신하지 못한다.
        `when`(permissions.existsByMemberIdAndPermission(operatorWithoutEvents.memberId, "notices")).thenReturn(true)
    }

    private fun assertForbidden(call: () -> Unit) {
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException::class.java) { call() }.statusCode)
    }

    @Test
    fun `every operation is forbidden before touching events unless an operator holds the events permission`() {
        givenEventsPermission()
        // 잘못된 입력도 검증보다 권한 검사가 먼저라 400이 아니라 403이다.
        val invalid = request.copy(title = "가".repeat(201))
        for (member in listOf(staleGrant, operatorWithoutEvents)) {
            assertForbidden { service.list(member) }
            assertForbidden { service.read(member, id) }
            assertForbidden { service.create(member, request) }
            assertForbidden { service.create(member, invalid) }
            assertForbidden { service.update(member, id, request) }
            assertForbidden { service.update(member, id, invalid) }
            assertForbidden { service.delete(member, id) }
        }
        verifyNoInteractions(events)
    }

    @Test
    fun `an events admin gets 400 for over long input before the event service is called`() {
        givenEventsPermission()
        // 길이 규칙의 출처는 EventRequest의 @Size다. 컨트롤러에 @Valid가 없으므로 권한 확인 뒤 서비스가 같은 규칙을 직접 검증해야 한다.
        for (invalid in listOf(request.copy(title = "가".repeat(201)), request.copy(body = "나".repeat(20_001)))) {
            assertThrows(ConstraintViolationException::class.java) { service.create(admin, invalid) }
            assertThrows(ConstraintViolationException::class.java) { service.update(admin, id, invalid) }
        }
        verifyNoInteractions(events)
    }

    @Test
    fun `an authorized admin delegates create read update and delete to the event service`() {
        givenEventsPermission()
        `when`(events.create(request)).thenReturn(event)
        `when`(events.read(id)).thenReturn(event)
        `when`(events.update(id, request)).thenReturn(event)

        assertEquals(event, service.create(admin, request))
        assertEquals(event, service.read(admin, id))
        assertEquals(event, service.update(admin, id, request))
        service.delete(admin, id)

        verify(events).delete(id)
    }

    @Test
    fun `list asks the event service for the latest 100 events`() {
        givenEventsPermission()
        val page = PageResponse(listOf(event), 0, 100, 1, 1)
        `when`(events.list(PageRequest.of(0, 100))).thenReturn(page)

        assertEquals(page, service.list(admin))
    }

    @Test
    fun `a missing id is not found for admins and forbidden before any lookup for everyone else`() {
        givenEventsPermission()
        `when`(events.read(id)).thenThrow(NoSuchElementException())

        assertThrows(NoSuchElementException::class.java) { service.read(admin, id) }
        assertForbidden { service.read(operatorWithoutEvents, id) }

        verify(events, times(1)).read(id)
    }
}
