package ai.storyfork.content.notice

import ai.storyfork.content.auth.config.OPERATOR_AUTHORITY
import ai.storyfork.content.notice.controller.WorkNoticeController
import ai.storyfork.content.notice.service.WorkNoticeService
import ai.storyfork.content.notice.service.dto.WorkNoticeRequest
import ai.storyfork.content.notice.service.dto.WorkNoticeResponse
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority

/** 컨트롤러는 Core가 확인한 운영자 authority를 서비스의 operator 값으로 옮기는 일만 한다. 권한 상승 경로라 서비스를 대역으로 두고 따로 고정한다. */
class WorkNoticeControllerTest {
    private val service = mock(WorkNoticeService::class.java)
    private val controller = WorkNoticeController(service)
    private val t0 = Instant.parse("2020-01-01T00:00:00Z")
    private val data = WorkNoticeRequest("info", "제목", "본문", false)
    private val shown = WorkNoticeResponse("n1", "work", "info", "제목", "본문", false, t0, t0)

    private fun member(vararg authorities: String) = UsernamePasswordAuthenticationToken.authenticated("member-1", null, authorities.map(::SimpleGrantedAuthority))

    @Test fun `only the operator authority from verification becomes the operator flag`() {
        for (operator in listOf(true, false)) {
            `when`(service.create("work", "member-1", operator, data)).thenReturn(shown)
            `when`(service.update("work", "n1", "member-1", operator, data)).thenReturn(shown)
        }

        controller.create("work", member(OPERATOR_AUTHORITY), data)
        controller.create("work", member(), data)
        // 다른 authority는 운영자가 아니다.
        controller.create("work", member("OPERATIONS_SERVICE"), data)
        controller.update("work", "n1", member(OPERATOR_AUTHORITY), data)
        controller.update("work", "n1", member(), data)
        controller.delete("work", "n1", member(OPERATOR_AUTHORITY))
        controller.delete("work", "n1", member())

        verify(service).create("work", "member-1", true, data)
        verify(service, times(2)).create("work", "member-1", false, data)
        verify(service).update("work", "n1", "member-1", true, data)
        verify(service).update("work", "n1", "member-1", false, data)
        verify(service).delete("work", "n1", "member-1", true)
        verify(service).delete("work", "n1", "member-1", false)
    }

    @Test fun `create answers 201 with the notice resource as Location`() {
        `when`(service.create("work", "member-1", false, data)).thenReturn(shown)

        val created = controller.create("work", member(), data)

        assertEquals(201, created.statusCode.value())
        assertEquals("/api/v1/works/work/notices/n1", created.headers.location.toString())
        assertEquals(shown, created.body)
    }
}
