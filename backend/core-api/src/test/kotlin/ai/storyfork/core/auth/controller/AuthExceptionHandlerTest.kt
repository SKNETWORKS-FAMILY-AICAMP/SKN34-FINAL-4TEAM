package ai.storyfork.core.auth.controller

import ai.storyfork.core.auth.service.AuthException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.springframework.http.MediaType
import org.springframework.mock.web.MockHttpServletResponse

class AuthExceptionHandlerTest {
    @Test
    fun `every other business failure reason keeps its original status-only response`() {
        val expected = mapOf(
            AuthException.Reason.INVALID to 400,
            AuthException.Reason.UNAUTHENTICATED to 401,
            AuthException.Reason.FORBIDDEN to 403,
            AuthException.Reason.NOT_FOUND to 404,
            AuthException.Reason.CONFLICT to 409,
            AuthException.Reason.UNAVAILABLE to 503,
        )
        assertEquals(AuthException.Reason.entries.toSet() - AuthException.Reason.RESTRICTED, expected.keys)
        for ((reason, status) in expected) {
            val response = MockHttpServletResponse()
            assertNull(AuthExceptionHandler().handle(AuthException(reason), response), reason.name)
            assertEquals(status, response.status, reason.name)
        }
    }

    @Test
    fun `restricted login is a 403 problem body carrying the account restricted code`() {
        val response = MockHttpServletResponse()

        val entity = requireNotNull(AuthExceptionHandler().handle(AuthException(AuthException.Reason.RESTRICTED), response))

        assertEquals(403, entity.statusCode.value())
        assertEquals(MediaType.APPLICATION_PROBLEM_JSON, entity.headers.contentType)
        val problem = requireNotNull(entity.body)
        assertEquals(403, problem.status)
        assertEquals("ACCOUNT_RESTRICTED", problem.properties?.get("code"))
        assertFalse(response.isCommitted, "sendError would replace the body with the servlet error page")
    }
}
