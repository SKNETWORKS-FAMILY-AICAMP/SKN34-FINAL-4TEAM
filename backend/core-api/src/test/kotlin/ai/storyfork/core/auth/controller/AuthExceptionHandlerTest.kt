package ai.storyfork.core.auth.controller

import ai.storyfork.core.auth.service.AuthException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.mock.web.MockHttpServletResponse

class AuthExceptionHandlerTest {
    @Test
    fun `every business failure reason keeps its original HTTP status`() {
        val expected = mapOf(
            AuthException.Reason.INVALID to 400,
            AuthException.Reason.UNAUTHENTICATED to 401,
            AuthException.Reason.FORBIDDEN to 403,
            AuthException.Reason.NOT_FOUND to 404,
            AuthException.Reason.CONFLICT to 409,
            AuthException.Reason.UNAVAILABLE to 503,
        )
        assertEquals(AuthException.Reason.entries.toSet(), expected.keys)
        for ((reason, status) in expected) {
            val response = MockHttpServletResponse()
            AuthExceptionHandler().handle(AuthException(reason), response)
            assertEquals(status, response.status, reason.name)
        }
    }
}
