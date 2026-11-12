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

/**
 * 내부 호출의 서비스 토큰 헤더를 확인한다. 기본은 운영 → Content의 `X-Operations-Service-Token`이며,
 * AI → Content Retrieval은 `X-Internal-Token`·`AI_SERVICE` 권한으로 같은 검사를 쓴다. 미설정·32자 미만·불일치는 403이다.
 */
class OperationsServiceTokenFilter(
    token: String,
    private val header: String = "X-Operations-Service-Token",
    private val authority: String = "OPERATIONS_SERVICE",
) : OncePerRequestFilter() {
    private val expected = token.takeIf { it.length >= 32 }?.let(::digest)

    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        val supplied = Collections.list(request.getHeaders(header)).singleOrNull()
        // Compare fixed-length digests so unequal token lengths do not short-circuit the comparison.
        if (expected == null || supplied == null || !MessageDigest.isEqual(expected, digest(supplied))) {
            SecurityContextHolder.clearContext()
            response.status = 403
            return
        }
        val context = SecurityContextHolder.createEmptyContext()
        context.authentication = PreAuthenticatedAuthenticationToken(authority.lowercase(), null, listOf(SimpleGrantedAuthority(authority)))
        SecurityContextHolder.setContext(context)
        try { chain.doFilter(request, response) } finally { SecurityContextHolder.clearContext() }
    }

    private fun digest(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
}
