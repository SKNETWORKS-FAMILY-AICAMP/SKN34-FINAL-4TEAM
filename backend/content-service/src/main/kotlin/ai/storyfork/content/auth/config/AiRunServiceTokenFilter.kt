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

/** AI → Content의 좁은 위임 검증 경로만 인증한다. 회원 Bearer나 중복 헤더는 대체 자격이 아니다. */
class AiRunServiceTokenFilter(token: String): OncePerRequestFilter() {
    private val expected=token.takeIf {it.length>=32 && it.isNotBlank() && it.none {c -> c=='\r' || c=='\n'}}?.let(::digest)
    override fun doFilterInternal(request: HttpServletRequest,response: HttpServletResponse,chain: FilterChain) {
        val supplied=Collections.list(request.getHeaders("X-Internal-Token")).singleOrNull()
        if(expected==null || supplied==null || !MessageDigest.isEqual(expected,digest(supplied))) {
            SecurityContextHolder.clearContext();response.status=403;return
        }
        val context=SecurityContextHolder.createEmptyContext()
        context.authentication=PreAuthenticatedAuthenticationToken("ai-service",null,listOf(SimpleGrantedAuthority("AI_RUN_SERVICE")))
        SecurityContextHolder.setContext(context)
        try {chain.doFilter(request,response)} finally {SecurityContextHolder.clearContext()}
    }
    private fun digest(value: String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
}
