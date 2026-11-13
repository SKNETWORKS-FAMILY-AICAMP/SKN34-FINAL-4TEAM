package ai.storyfork.content.auth

import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.ScheduledMemberPayload
import ai.storyfork.content.auth.client.VerifiedMemberResponse
import ai.storyfork.content.auth.client.dto.NicknamesPayload
import ai.storyfork.content.auth.client.dto.NicknamesResponse
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
    @Test fun `a verified operator gets the operator authority and a plain member gets none`() {
        for (operator in listOf(true, false)) {
            val id = UUID.randomUUID()
            val request = mock(HttpServletRequest::class.java)
            val response = mock(HttpServletResponse::class.java)
            val chain = mock(FilterChain::class.java)
            `when`(request.getHeader("Authorization")).thenReturn("Bearer opaque-user-token")
            var seen: Authentication? = null
            doAnswer { seen = SecurityContextHolder.getContext().authentication; null }.`when`(chain).doFilter(request, response)
            val client = object : CoreAuthClient {
                override fun verify(authorization: String) = VerifiedMemberResponse(id, operator)
                override fun nicknames(request: NicknamesPayload): NicknamesResponse = throw UnsupportedOperationException("verify only")
                override fun verifyScheduledMember(request: ScheduledMemberPayload) = error("scheduled verification is unused")
            }
            try {
                ContentAuthenticationFilter(CoreAuthVerificationService(client), JsonMapper.builder().build()).doFilter(request, response, chain)
                // Principal 이름은 그대로 회원 UUID이고, 운영자 여부는 authority로만 전달된다.
                assertEquals(id.toString(), seen?.name, "operator=$operator")
                assertEquals(true, seen?.isAuthenticated, "operator=$operator")
                assertEquals(if (operator) listOf("ROLE_OPERATOR") else emptyList<String>(), seen?.authorities?.map { it.authority }, "operator=$operator")
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
                override fun nicknames(request: NicknamesPayload): NicknamesResponse = throw UnsupportedOperationException("verify only")
                override fun verifyScheduledMember(request: ai.storyfork.content.auth.client.ScheduledMemberPayload) = error("scheduled verification is unused")
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
