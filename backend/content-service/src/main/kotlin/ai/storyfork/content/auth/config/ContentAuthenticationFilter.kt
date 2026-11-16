package ai.storyfork.content.auth.config

import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreAuthVerificationService
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.HttpHeaders
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.web.filter.OncePerRequestFilter
import tools.jackson.databind.json.JsonMapper

/** Core가 운영자(`operator=true`)로 확인한 회원의 인증 객체에만 담기는 authority다. */
const val OPERATOR_AUTHORITY = "ROLE_OPERATOR"

/** 사용자 ID 헤더/쿠키는 신뢰하지 않고 Core가 확인한 UUID만 Principal로 만든다. */
class ContentAuthenticationFilter(private val service: CoreAuthVerificationService, private val mapper: JsonMapper) : OncePerRequestFilter() {
    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        val authorization = request.getHeader(HttpHeaders.AUTHORIZATION)
        if (authorization != null && authorization.startsWith("Bearer", ignoreCase = true)) {
            val member = try { service.verify(authorization) } catch (error: CoreAuthException) {
                SecurityContextHolder.clearContext()
                response.status = error.status
                response.contentType = "application/json"
                response.characterEncoding = "UTF-8"
                if (error.status == 401) response.setHeader(HttpHeaders.WWW_AUTHENTICATE, "Bearer")
                mapper.writeValue(response.writer, VerificationErrorResponse(error.message.orEmpty(), error.code))
                return
            }
            val context = SecurityContextHolder.createEmptyContext()
            val authorities = if (member.operator) listOf(SimpleGrantedAuthority(OPERATOR_AUTHORITY)) else emptyList()
            context.authentication = UsernamePasswordAuthenticationToken.authenticated(member.memberId.toString(), null, authorities)
            SecurityContextHolder.setContext(context)
        }
        chain.doFilter(request, response)
    }
}

private data class VerificationErrorResponse(val detail: String, val code: String)
