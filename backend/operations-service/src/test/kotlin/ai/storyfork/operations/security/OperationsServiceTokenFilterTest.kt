package ai.storyfork.operations.security

import jakarta.servlet.FilterChain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.security.core.context.SecurityContextHolder
import tools.jackson.databind.json.JsonMapper

/** Servlet test doubles only: no Spring context, HTTP transport or database. */
class OperationsServiceTokenFilterTest {
    private val token = "test-service-only-0123456789abcdef"
    private val mapper = JsonMapper.builder().build()

    @AfterEach
    fun clearContext() = SecurityContextHolder.clearContext()

    @Test
    fun `no default browser user account is created`() {
        val users = OperationsSecurityConfig().operationsUsers()
        assertFalse(users.userExists("user"))
        assertFalse(users.userExists("admin"))
    }

    @Test
    fun `missing blank wrong and duplicate tokens are denied before the chain`() {
        for (headers in listOf(emptyList(), listOf(""), listOf(" "), listOf("wrong"),
            listOf(token + "x"), listOf(token, token), listOf("wrong", token))) {
            val request = MockHttpServletRequest("POST", "/api/v1/operations/notices")
            headers.forEach { request.addHeader("X-Operations-Service-Token", it) }
            val response = MockHttpServletResponse()
            OperationsServiceTokenFilter(token, mapper).doFilter(request, response, FilterChain { _, _ ->
                fail<Unit>("Rejected credentials reached the resource")
            })
            assertEquals(401, response.status, headers.size.toString())
            val body = mapper.readTree(response.contentAsString)
            assertEquals("UNAUTHORIZED", body["code"].asString())
            assertEquals("Authentication required.", body["message"].asString())
            assertFalse(response.contentAsString.contains(token))
            assertNull(SecurityContextHolder.getContext().authentication)
        }
    }

    @Test
    fun `missing or whitespace only server configuration fails closed even with a supplied token`() {
        for (configured in listOf("", " ", "\t")) {
            val request = MockHttpServletRequest("GET", "/api/v1/operations/events")
            request.addHeader("X-Operations-Service-Token", token)
            val response = MockHttpServletResponse()
            OperationsServiceTokenFilter(configured, mapper).doFilter(request, response, FilterChain { _, _ ->
                fail<Unit>("Disabled configuration permitted access")
            })
            assertEquals(401, response.status)
        }
    }

    @Test
    fun `exact token establishes only service authority and never keeps credentials`() {
        for (method in listOf("GET", "POST", "PUT", "DELETE")) {
            val request = MockHttpServletRequest(method, "/api/v1/operations/inquiries")
            request.addHeader("X-Operations-Service-Token", token)
            val response = MockHttpServletResponse()
            var calls = 0
            OperationsServiceTokenFilter(token, mapper).doFilter(request, response, FilterChain { _, _ ->
                calls++
                val authentication = checkNotNull(SecurityContextHolder.getContext().authentication)
                assertTrue(authentication.isAuthenticated)
                assertEquals("operations-service", authentication.name)
                assertNull(authentication.credentials)
                assertEquals(listOf("OPERATIONS_SERVICE"), authentication.authorities.map { it.authority })
            })
            assertEquals(1, calls)
            assertNull(SecurityContextHolder.getContext().authentication)
            assertNull(response.getHeader("Set-Cookie"))
        }
    }

    @Test
    fun `bearer user and cookie hints cannot replace the service token`() {
        val request = MockHttpServletRequest("GET", "/api/v1/operations/notices")
        request.addHeader("Authorization", "Bearer $token")
        request.addHeader("X-Auth-User", "invented-admin")
        request.addHeader("Cookie", "JSESSIONID=$token")
        val response = MockHttpServletResponse()
        OperationsServiceTokenFilter(token, mapper).doFilter(request, response, FilterChain { _, _ ->
            fail<Unit>("A browser credential was accepted")
        })
        assertEquals(401, response.status)
        assertNull(response.getHeader("Set-Cookie"))
    }

    @Test
    fun `token whitespace is not silently trimmed and authentication is cleared after failure`() {
        val request = MockHttpServletRequest("PUT", "/api/v1/operations/notices")
        request.addHeader("X-Operations-Service-Token", " $token ")
        val response = MockHttpServletResponse()
        val filter = OperationsServiceTokenFilter(token, mapper)
        filter.doFilter(request, response, FilterChain { _, _ -> fail<Unit>("Padded token accepted") })
        assertEquals(401, response.status)

        request.removeHeader("X-Operations-Service-Token")
        request.addHeader("X-Operations-Service-Token", token)
        assertThrows(IllegalStateException::class.java) {
            filter.doFilter(request, MockHttpServletResponse(), FilterChain { _, _ -> throw IllegalStateException("resource failure") })
        }
        assertNull(SecurityContextHolder.getContext().authentication)
    }
}
