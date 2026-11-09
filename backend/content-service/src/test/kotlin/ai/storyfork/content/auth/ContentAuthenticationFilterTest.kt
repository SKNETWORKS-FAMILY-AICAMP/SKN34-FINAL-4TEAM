package ai.storyfork.content.auth

import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
import ai.storyfork.content.auth.config.ContentAuthenticationFilter
import ai.storyfork.content.auth.service.CoreAuthVerificationService
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import java.io.PrintWriter
import java.io.StringWriter
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.security.core.Authentication
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.web.client.HttpClientErrorException
import tools.jackson.databind.json.JsonMapper

/** Servlet collaborators are mocks; no Spring context or HTTP transport. */
class ContentAuthenticationFilterTest {
    @Test fun `verified member keeps the UUID principal name and carries the nickname in details`() {
        for (nickname in listOf("닉네임", null)) {
            val id = UUID.randomUUID()
            val request = mock(HttpServletRequest::class.java)
            val response = mock(HttpServletResponse::class.java)
            `when`(request.getHeader("Authorization")).thenReturn("Bearer opaque-user-token")
            val client = object : CoreAuthClient {
                override fun verify(authorization: String) = VerifiedMemberResponse(id, nickname)
            }
            var seen: Authentication? = null
            val chain = FilterChain { _, _ -> seen = SecurityContextHolder.getContext().authentication }
            try {
                ContentAuthenticationFilter(CoreAuthVerificationService(client), JsonMapper.builder().build()).doFilter(request, response, chain)
                assertEquals(id.toString(), seen?.name)
                assertEquals(nickname, seen?.details, "details must be the nickname String or null, never a placeholder")
            } finally {
                SecurityContextHolder.clearContext()
            }
        }
    }

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
