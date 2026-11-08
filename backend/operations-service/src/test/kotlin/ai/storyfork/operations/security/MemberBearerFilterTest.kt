package ai.storyfork.operations.security

import ai.storyfork.operations._common.client.CoreClient
import jakarta.servlet.FilterChain
import java.util.UUID
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.json.JsonMapper

/** Servlet test doubles and a mocked Core client: no Spring context, HTTP transport or database. */
class MemberBearerFilterTest {
    private val core = mock(CoreClient::class.java)
    private val mapper = JsonMapper.builder().build()
    private val filter = MemberBearerFilter(core, mapper)
    private val bearer = "Bearer member-access"

    @AfterEach
    fun clearContext() = SecurityContextHolder.clearContext()

    private fun request(authorization: String? = bearer) = MockHttpServletRequest("GET", "/api/v1/operations/reports/mine").apply {
        authorization?.let { addHeader("Authorization", it) }
    }

    @Test
    fun `Core verified member becomes the principal only for the current request`() {
        val member = OperationsMember(UUID.randomUUID(), true)
        `when`(core.verify(bearer)).thenReturn(member)
        var seen: Any? = null

        filter.doFilter(request(), MockHttpServletResponse(), FilterChain { _, _ ->
            seen = SecurityContextHolder.getContext().authentication?.principal
        })

        assertEquals(member, seen)
        assertNull(SecurityContextHolder.getContext().authentication)
    }

    @Test
    fun `missing or non Bearer authorization continues anonymously without calling Core`() {
        for (header in listOf(null, "Basic abc")) {
            var called = false
            filter.doFilter(request(header), MockHttpServletResponse(), FilterChain { _, _ ->
                called = true
                assertNull(SecurityContextHolder.getContext().authentication)
            })
            assertTrue(called)
        }
        verifyNoInteractions(core)
    }

    @Test
    fun `Core 401 403 and other failures stop the chain with safe codes`() {
        for ((status, code) in listOf(HttpStatus.UNAUTHORIZED to "UNAUTHORIZED", HttpStatus.FORBIDDEN to "FORBIDDEN",
            HttpStatus.BAD_GATEWAY to "UPSTREAM_FAILED")) {
            reset(core)
            `when`(core.verify(bearer)).thenThrow(ResponseStatusException(status))
            val response = MockHttpServletResponse()

            filter.doFilter(request(), response, FilterChain { _, _ -> fail<Unit>("Rejected bearer reached the resource") })

            assertEquals(status.value(), response.status)
            assertEquals(code, mapper.readTree(response.contentAsString)["code"].asString())
            assertFalse(response.contentAsString.contains("member-access"))
        }
    }
}
