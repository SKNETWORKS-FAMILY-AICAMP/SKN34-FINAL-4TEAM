package ai.storyfork.content.auth

import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.config.ContentAuthenticationFilter
import ai.storyfork.content.auth.service.CoreAuthVerificationService
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import java.io.PrintWriter
import java.io.StringWriter
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.web.client.HttpClientErrorException
import tools.jackson.databind.json.JsonMapper

/** Servlet collaborators are mocks; no Spring context or HTTP transport. */
class ContentAuthenticationFilterTest {
    @Test fun `malformed bearer on public GET is verified and rejected rather than treated as anonymous`() {
        for (header in listOf("Bearer", "Bearerbroken", "bEaReR\tbroken")) {
            val request = mock(HttpServletRequest::class.java)
            val response = mock(HttpServletResponse::class.java)
            val chain = mock(FilterChain::class.java)
            `when`(request.method).thenReturn("GET")
            `when`(request.requestURI).thenReturn("/api/v1/public/works")
            `when`(request.getHeader("Authorization")).thenReturn(header)
            `when`(response.writer).thenReturn(PrintWriter(StringWriter()))
            var calls = 0
            val client = object : CoreAuthClient {
                override fun verify(authorization: String): ai.storyfork.content.auth.client.VerifiedMemberResponse {
                    assertEquals(header, authorization)
                    calls++
                    throw HttpClientErrorException(HttpStatus.UNAUTHORIZED)
                }
            }
            try {
                ContentAuthenticationFilter(CoreAuthVerificationService(client), JsonMapper.builder().build())
                    .doFilter(request, response, chain)
                assertEquals(1, calls, header)
                verify(response).setStatus(401)
                verify(response).setHeader("WWW-Authenticate", "Bearer")
                verifyNoInteractions(chain)
                assertNull(SecurityContextHolder.getContext().authentication)
            } finally {
                SecurityContextHolder.clearContext()
            }
        }
    }
}
