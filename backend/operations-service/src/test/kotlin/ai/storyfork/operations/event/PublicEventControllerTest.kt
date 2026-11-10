package ai.storyfork.operations.event

import ai.storyfork.operations._common.service.dto.PageResponse
import ai.storyfork.operations.event.controller.PublicEventController
import ai.storyfork.operations.event.service.EventService
import ai.storyfork.operations.event.service.dto.EventResponse
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.data.domain.PageRequest

/** Spring context나 HTTP 서버 없이 독자 공개 조회가 기존 EventService만 읽기로 호출하는지 확인한다. */
class PublicEventControllerTest {
    private val service = mock(EventService::class.java)
    private val controller = PublicEventController(service)
    private val id = UUID.randomUUID()
    private val time = Instant.parse("2026-11-05T01:00:00Z")
    // 종료된 이벤트도 서버는 걸러 내지 않고 그대로 돌려준다(진행 상태는 화면이 계산).
    private val ended = EventResponse(id, "지난 이벤트", "본문", time.minusSeconds(7200), time.minusSeconds(3600), time, time)

    @Test
    fun `list returns the latest 100 events including ended ones`() {
        val page = PageResponse(listOf(ended), 0, 100, 1, 1)
        `when`(service.list(PageRequest.of(0, 100))).thenReturn(page)

        assertEquals(page, controller.list())
    }

    @Test
    fun `detail returns the event and a missing id is not found`() {
        `when`(service.read(id)).thenReturn(ended)
        val missing = UUID.randomUUID()
        `when`(service.read(missing)).thenThrow(NoSuchElementException())

        assertEquals(ended, controller.read(id))
        assertThrows(NoSuchElementException::class.java) { controller.read(missing) }
    }
}
