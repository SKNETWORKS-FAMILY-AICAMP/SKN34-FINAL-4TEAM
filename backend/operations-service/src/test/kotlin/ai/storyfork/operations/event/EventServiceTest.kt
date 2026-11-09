package ai.storyfork.operations.event

import ai.storyfork.operations.event.entity.EventEntity
import ai.storyfork.operations.event.repository.EventRepository
import ai.storyfork.operations.event.service.EventService
import ai.storyfork.operations.event.service.dto.EventRequest
import java.time.Instant
import java.util.Optional
import java.util.UUID
import java.util.stream.Stream
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource
import org.mockito.ArgumentCaptor
import org.mockito.Mock
import org.mockito.Mockito.*
import org.mockito.junit.jupiter.MockitoExtension
import org.springframework.data.domain.PageImpl
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Pageable
import org.springframework.data.domain.Sort

@ExtendWith(MockitoExtension::class)
class EventServiceTest {
    @Mock lateinit var events: EventRepository
    private val service get() = EventService(events)
    private val start = Instant.parse("2026-11-05T01:00:00Z")
    private val end = Instant.parse("2026-11-06T01:00:00Z")

    @Test
    fun `create persists the announcement with generated identity and UTC timestamps`() {
        val before = Instant.now().minusSeconds(1)
        `when`(events.save(any(EventEntity::class.java))).thenAnswer { it.getArgument<EventEntity>(0) }

        val response = service.create(EventRequest("이벤트", "이벤트 안내"))

        val saved = ArgumentCaptor.forClass(EventEntity::class.java)
        verify(events).save(saved.capture())
        assertEquals(saved.value.id, response.id)
        assertEquals("이벤트", response.title)
        assertEquals("이벤트 안내", response.body)
        assertNull(response.startsAt)
        assertNull(response.endsAt)
        assertFalse(response.createdAt.isBefore(before))
        assertFalse(response.createdAt.isAfter(Instant.now()))
        assertEquals(response.createdAt, response.updatedAt)
        assertEquals(0, response.createdAt.nano % 1_000)
    }

    @Test
    fun `create accepts maximum title and body lengths`() {
        `when`(events.save(any(EventEntity::class.java))).thenAnswer { it.getArgument<EventEntity>(0) }
        val response = service.create(EventRequest("가".repeat(200), "나".repeat(20_000), start, end))
        assertEquals(200, response.title.length)
        assertEquals(20_000, response.body.length)
        assertEquals(start, response.startsAt)
        assertEquals(end, response.endsAt)
    }

    @ParameterizedTest
    @MethodSource("validPeriods")
    fun `create accepts absent single ended and equal periods`(request: EventRequest) {
        `when`(events.save(any(EventEntity::class.java))).thenAnswer { it.getArgument<EventEntity>(0) }
        val response = service.create(request)
        assertEquals(request.startsAt, response.startsAt)
        assertEquals(request.endsAt, response.endsAt)
    }

    @ParameterizedTest
    @MethodSource("invalidRequests")
    fun `invalid creation never reaches persistence`(request: EventRequest) {
        lenient().`when`(events.save(any(EventEntity::class.java))).thenAnswer { it.getArgument<EventEntity>(0) }
        assertThrows(IllegalArgumentException::class.java) { service.create(request) }
        verifyNoInteractions(events)
    }

    @Test
    fun `reversed event dates are rejected before persistence`() {
        lenient().`when`(events.save(any(EventEntity::class.java))).thenAnswer { it.getArgument<EventEntity>(0) }
        assertThrows(IllegalArgumentException::class.java) {
            service.create(EventRequest("이벤트", "안내", end, start))
        }
        verifyNoInteractions(events)
    }

    @Test
    fun `detail returns an explicit DTO with saved UTC period`() {
        val event = existing()
        `when`(events.findById(event.id)).thenReturn(Optional.of(event))
        val response = service.read(event.id)
        assertEquals(event.id, response.id)
        assertEquals(event.title, response.title)
        assertEquals(event.body, response.body)
        assertEquals(start, response.startsAt)
        assertEquals(end, response.endsAt)
        assertEquals(event.createdAt, response.createdAt)
        assertEquals(event.updatedAt, response.updatedAt)
    }

    @Test
    fun `list uses bounded pageable and fixed timestamp then UUID ordering`() {
        val request = PageRequest.of(2, 100, Sort.by("body"))
        val expected = PageRequest.of(2, 100, Sort.by(Sort.Direction.DESC, "createdAt", "id"))
        val event = existing()
        `when`(events.findAll(any(Pageable::class.java))).thenReturn(PageImpl(listOf(event), expected, 201))

        val response = service.list(request)

        verify(events).findAll(expected)
        assertEquals(listOf(event.id), response.items.map { it.id })
        assertEquals(2, response.page)
        assertEquals(100, response.size)
        assertEquals(201L, response.totalElements)
        assertEquals(3, response.totalPages)
    }

    @Test
    fun `list returns an empty explicit page without exposing a JPA page`() {
        val pageable = PageRequest.of(0, 20, Sort.by(Sort.Direction.DESC, "createdAt", "id"))
        `when`(events.findAll(any(Pageable::class.java))).thenReturn(PageImpl(emptyList(), pageable, 0))
        val response = service.list(PageRequest.of(0, 20))
        assertTrue(response.items.isEmpty())
        assertEquals(0, response.page)
        assertEquals(20, response.size)
        assertEquals(0L, response.totalElements)
        assertEquals(0, response.totalPages)
    }

    @Test
    fun `full update replaces all mutable fields while preserving identity and creation time`() {
        val event = existing()
        val createdAt = event.createdAt
        val updatedAt = event.updatedAt
        `when`(events.findById(event.id)).thenReturn(Optional.of(event))

        val response = service.update(event.id, EventRequest("새 제목", "새 본문", start, end.plusSeconds(3600)))

        assertEquals(event.id, response.id)
        assertEquals(createdAt, response.createdAt)
        assertEquals("새 제목", event.title)
        assertEquals("새 본문", event.body)
        assertEquals(start, response.startsAt)
        assertEquals(end.plusSeconds(3600), response.endsAt)
        assertTrue(response.updatedAt.isAfter(updatedAt))
        assertEquals(0, response.updatedAt.nano % 1_000)
        verify(events, never()).save(any(EventEntity::class.java))
    }

    @Test
    fun `full update clears an omitted optional period`() {
        val event = existing()
        `when`(events.findById(event.id)).thenReturn(Optional.of(event))
        val response = service.update(event.id, EventRequest("제목", "본문"))
        assertNull(event.startsAt)
        assertNull(event.endsAt)
        assertNull(response.startsAt)
        assertNull(response.endsAt)
    }

    @ParameterizedTest
    @MethodSource("invalidRequests")
    fun `invalid update preserves every old row field`(request: EventRequest) {
        val event = existing()
        val updatedAt = event.updatedAt
        `when`(events.findById(event.id)).thenReturn(Optional.of(event))

        assertThrows(IllegalArgumentException::class.java) { service.update(event.id, request) }

        assertEquals("원래 제목", event.title)
        assertEquals("원래 본문", event.body)
        assertEquals(start, event.startsAt)
        assertEquals(end, event.endsAt)
        assertEquals(updatedAt, event.updatedAt)
        verify(events).findById(event.id)
        verifyNoMoreInteractions(events)
    }

    @Test
    fun `missing detail returns not found`() {
        val id = UUID.randomUUID()
        `when`(events.findById(id)).thenReturn(Optional.empty())
        assertThrows(NoSuchElementException::class.java) { service.read(id) }
    }

    @Test
    fun `missing update returns not found without writes`() {
        val id = UUID.randomUUID()
        `when`(events.findById(id)).thenReturn(Optional.empty())
        assertThrows(NoSuchElementException::class.java) { service.update(id, EventRequest("제목", "본문")) }
        verify(events).findById(id)
        verifyNoMoreInteractions(events)
    }

    @Test
    fun `delete loads and removes the versioned entity`() {
        val event = existing()
        `when`(events.findById(event.id)).thenReturn(Optional.of(event))
        service.delete(event.id)
        verify(events).delete(event)
    }

    @Test
    fun `missing deletion returns not found instead of silently succeeding`() {
        val id = UUID.randomUUID()
        `when`(events.findById(id)).thenReturn(Optional.empty())
        assertThrows(NoSuchElementException::class.java) { service.delete(id) }
        verify(events).findById(id)
        verifyNoMoreInteractions(events)
    }

    private fun existing() = EventEntity(
        title = "원래 제목", body = "원래 본문", startsAt = start, endsAt = end,
        createdAt = Instant.parse("2026-01-01T00:00:00Z"),
        updatedAt = Instant.parse("2026-01-01T00:00:00Z"), version = 0,
    )

    companion object {
        @JvmStatic
        fun validPeriods(): Stream<EventRequest> {
            val instant = Instant.parse("2026-11-05T01:00:00Z")
            return Stream.of(
                EventRequest("제목", "본문"),
                EventRequest("제목", "본문", instant, null),
                EventRequest("제목", "본문", null, instant),
                EventRequest("제목", "본문", instant, instant),
            )
        }

        // 공백·길이는 EventRequest의 @Valid가 거절한다(RequestValidationTest). 서비스는 U+0000과 기간 순서만 거절한다.
        @JvmStatic
        fun invalidRequests(): Stream<EventRequest> = Stream.of(
            EventRequest("제\u0000목", "본문"),
            EventRequest("제목", "본\u0000문"),
            EventRequest("제목", "본문", Instant.parse("2026-11-06T00:00:00Z"), Instant.parse("2026-11-05T00:00:00Z")),
        )
    }
}
