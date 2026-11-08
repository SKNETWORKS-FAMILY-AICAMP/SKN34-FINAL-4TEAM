package ai.storyfork.content.auth.config

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import java.security.MessageDigest
import java.util.Collections
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.web.authentication.preauth.PreAuthenticatedAuthenticationToken
import org.springframework.web.filter.OncePerRequestFilter

/** 운영 → Content 내부 호출의 `X-Operations-Service-Token`을 확인한다. 미설정·32자 미만·불일치는 403이다. */
class OperationsServiceTokenFilter(token: String) : OncePerRequestFilter() {
    private val expected = token.takeIf { it.length >= 32 }?.let(::digest)

    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        val supplied = Collections.list(request.getHeaders("X-Operations-Service-Token")).singleOrNull()
        // Compare fixed-length digests so unequal token lengths do not short-circuit the comparison.
        if (expected == null || supplied == null || !MessageDigest.isEqual(expected, digest(supplied))) {
            SecurityContextHolder.clearContext()
            response.status = 403
            return
        }
        val context = SecurityContextHolder.createEmptyContext()
        context.authentication = PreAuthenticatedAuthenticationToken("operations-service", null, listOf(SimpleGrantedAuthority("OPERATIONS_SERVICE")))
        SecurityContextHolder.setContext(context)
        try { chain.doFilter(request, response) } finally { SecurityContextHolder.clearContext() }
    }

    private fun digest(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
}
