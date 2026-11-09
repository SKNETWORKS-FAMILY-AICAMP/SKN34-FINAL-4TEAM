package ai.storyfork.operations.security

import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations._common.service.dto.OperationsErrorResponse
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import java.util.UUID
import org.springframework.http.HttpHeaders
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.web.filter.OncePerRequestFilter
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.json.JsonMapper

/** Core-verified member; `operator` is the Core ADMIN role. Business permissions live in `admin_permission`. */
data class OperationsMember(val memberId: UUID, val operator: Boolean)

/** Only a Core-verified Bearer becomes the principal; user ID headers or cookies are never trusted. */
class MemberBearerFilter(private val core: CoreClient, private val mapper: JsonMapper) : OncePerRequestFilter() {
    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        val authorization = request.getHeader(HttpHeaders.AUTHORIZATION)
        if (authorization == null || !authorization.startsWith("Bearer ", ignoreCase = true)) return chain.doFilter(request, response)
        val member = try {
            core.verify(authorization)
        } catch (error: ResponseStatusException) {
            SecurityContextHolder.clearContext()
            val status = error.statusCode.value()
            response.writeError(mapper, status, when (status) {
                401 -> OperationsErrorResponse("UNAUTHORIZED", "Authentication required.")
                403 -> OperationsErrorResponse("FORBIDDEN", "Access denied.")
                else -> OperationsErrorResponse("UPSTREAM_FAILED", "Upstream service request failed.")
            })
            return
        }
        val context = SecurityContextHolder.createEmptyContext()
        context.authentication = UsernamePasswordAuthenticationToken.authenticated(member, null, emptyList())
        SecurityContextHolder.setContext(context)
        try {
            chain.doFilter(request, response)
        } finally {
            SecurityContextHolder.clearContext()
        }
    }
}
