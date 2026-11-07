package ai.storyfork.core.notification.controller

import ai.storyfork.core.notification.service.NoticeException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.mock.web.MockHttpServletResponse

class NoticeExceptionHandlerTest {
    @Test
    fun `every business failure reason keeps its original HTTP status`() {
        val expected = mapOf(
            NoticeException.Reason.INVALID to 400,
            NoticeException.Reason.UNAUTHENTICATED to 401,
            NoticeException.Reason.NOT_FOUND to 404,
        )
        assertEquals(NoticeException.Reason.entries.toSet(), expected.keys)
        for ((reason, status) in expected) {
            val response = MockHttpServletResponse()
            NoticeExceptionHandler().handle(NoticeException(reason), response)
            assertEquals(status, response.status, reason.name)
        }
    }
}
