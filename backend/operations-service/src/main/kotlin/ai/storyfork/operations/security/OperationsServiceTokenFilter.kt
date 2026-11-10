package ai.storyfork.operations.security

import ai.storyfork.operations._common.service.dto.OperationsErrorResponse
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import java.security.MessageDigest
import java.util.Collections
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.web.authentication.preauth.PreAuthenticatedAuthenticationToken
import org.springframework.web.filter.OncePerRequestFilter
import tools.jackson.databind.json.JsonMapper

class OperationsServiceTokenFilter(token: String, private val mapper: JsonMapper) : OncePerRequestFilter() {
    private val expected = token.takeUnless { it.isBlank() }?.let(::digest)

    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        val headers = Collections.list(request.getHeaders("X-Operations-Service-Token"))
        val supplied = headers.singleOrNull()?.takeUnless { it.isBlank() }
        // Compare fixed-length digests so unequal token lengths do not short-circuit the comparison.
        if (expected == null || supplied == null || !MessageDigest.isEqual(expected, digest(supplied))) {
            SecurityContextHolder.clearContext()
            response.writeError(mapper, 401, OperationsErrorResponse("UNAUTHORIZED", "Authentication required."))
            return
        }
        val context = SecurityContextHolder.createEmptyContext()
        context.authentication = PreAuthenticatedAuthenticationToken(
            "operations-service", null, listOf(SimpleGrantedAuthority("OPERATIONS_SERVICE")),
        )
        SecurityContextHolder.setContext(context)
        try {
            chain.doFilter(request, response)
        } finally {
            SecurityContextHolder.clearContext()
        }
    }

    private fun digest(value: String): ByteArray = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
}
