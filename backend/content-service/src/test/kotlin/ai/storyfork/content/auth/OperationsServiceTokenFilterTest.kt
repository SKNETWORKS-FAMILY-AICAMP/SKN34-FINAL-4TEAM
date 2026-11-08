package ai.storyfork.content.auth

import ai.storyfork.content.auth.config.OperationsServiceTokenFilter
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import java.util.Collections
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

/** Servlet collaborators are mocks; no Spring context or HTTP transport. */
class OperationsServiceTokenFilterTest {
    private val token = "o".repeat(32)

    private fun run(configured: String, vararg supplied: String): Pair<HttpServletResponse, FilterChain> {
        val request = mock(HttpServletRequest::class.java)
        val response = mock(HttpServletResponse::class.java)
        val chain = mock(FilterChain::class.java)
        `when`(request.getHeaders("X-Operations-Service-Token")).thenReturn(Collections.enumeration(supplied.toList()))
        OperationsServiceTokenFilter(configured).doFilter(request, response, chain)
        return response to chain
    }

    @Test fun `matching operations token passes`() {
        val (response, chain) = run(token, token)
        verify(chain).doFilter(any(), any())
        verify(response, never()).status = 403
    }

    @Test fun `missing wrong duplicated unset or short token is forbidden`() {
        for ((configured, supplied) in listOf(
            token to emptyArray(), token to arrayOf("x".repeat(32)), token to arrayOf(token, token),
            "" to arrayOf(""), "short" to arrayOf("short"),
        )) {
            val (response, chain) = run(configured, *supplied)
            verify(response).status = 403
            verifyNoInteractions(chain)
        }
    }
}
