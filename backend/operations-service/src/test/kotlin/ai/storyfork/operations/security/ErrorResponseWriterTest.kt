package ai.storyfork.operations.security

import ai.storyfork.operations._common.service.dto.OperationsErrorResponse
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.mock.web.MockHttpServletResponse
import tools.jackson.databind.json.JsonMapper

/** Servlet response double only: no Spring context or HTTP transport. */
class ErrorResponseWriterTest {
    @Test
    fun `writeError answers with the status and the shared JSON error DTO and keeps headers set before it`() {
        val response = MockHttpServletResponse()
        response.setHeader("WWW-Authenticate", "Bearer")

        response.writeError(JsonMapper.builder().build(), 401, OperationsErrorResponse("UNAUTHORIZED", "Authentication required."))

        assertEquals(401, response.status)
        assertEquals("application/json", response.contentType)
        assertEquals("""{"code":"UNAUTHORIZED","message":"Authentication required."}""", response.contentAsString)
        assertEquals("Bearer", response.getHeader("WWW-Authenticate"))
    }
}
