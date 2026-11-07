package ai.storyfork.operations.notice

import ai.storyfork.operations.notice.controller.NoticeController
import ai.storyfork.operations.notice.service.NoticeService
import ai.storyfork.operations.notice.service.dto.NoticeRequest
import ai.storyfork.operations.notice.service.dto.NoticeResponse
import java.net.URI
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.springframework.http.HttpStatus

/** Spring·MockMvc 없이 생성 결과의 상태·Location만 검증하는 순수 단위 테스트다. */
class NoticeControllerTest {
    @Test
    fun `create responds with 201 and the created resource Location`() {
        val service = mock(NoticeService::class.java)
        val request = NoticeRequest("제목", "본문")
        val now = Instant.parse("2026-01-01T00:00:00Z")
        val notice = NoticeResponse(UUID.randomUUID(), request.title, request.body, now, now)
        `when`(service.create(request)).thenReturn(notice)

        val result = NoticeController(service).create(request)

        assertEquals(HttpStatus.CREATED, result.statusCode)
        assertEquals(URI.create("/api/v1/operations/notices/${notice.id}"), result.headers.location)
        assertSame(notice, result.body)
    }
}
