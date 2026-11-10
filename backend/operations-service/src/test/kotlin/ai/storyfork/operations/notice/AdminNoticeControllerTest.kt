package ai.storyfork.operations.notice

import ai.storyfork.operations.notice.controller.AdminNoticeController
import ai.storyfork.operations.notice.service.AdminNoticeService
import ai.storyfork.operations.notice.service.dto.NoticeRequest
import ai.storyfork.operations.notice.service.dto.NoticeResponse
import ai.storyfork.operations.security.OperationsMember
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
class AdminNoticeControllerTest {
    @Test
    fun `create responds with 201 and the admin resource Location`() {
        val service = mock(AdminNoticeService::class.java)
        val member = OperationsMember(UUID.randomUUID(), true)
        val request = NoticeRequest("제목", "본문")
        val now = Instant.parse("2026-01-01T00:00:00Z")
        val notice = NoticeResponse(UUID.randomUUID(), request.title, request.body, now, now)
        `when`(service.create(member, request)).thenReturn(notice)

        val result = AdminNoticeController(service).create(member, request)

        assertEquals(HttpStatus.CREATED, result.statusCode)
        assertEquals(URI.create("/api/v1/operations/admin/notices/${notice.id}"), result.headers.location)
        assertSame(notice, result.body)
    }
}
