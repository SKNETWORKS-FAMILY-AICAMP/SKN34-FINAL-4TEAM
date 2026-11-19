package ai.storyfork.core.auth.config

import ai.storyfork.core.auth.service.SessionService
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.HttpHeaders
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.FactorGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.web.filter.OncePerRequestFilter
import org.springframework.web.util.UriComponentsBuilder
import org.springframework.web.util.UriUtils

/** authorize 경로. refresh 쿠키의 경로(/api/v1/auth) 안이라 브라우저가 쿠키를 함께 보낸다. */
private const val AUTHORIZE_PATH = "$OIDC_PATH/authorize"

/**
 * OIDC authorize 요청의 로그인 상태를 refresh_token 쿠키로 정한다(회전 없이 검증만, [SessionService.verifyRefreshToken]).
 * 로그인한 operator는 그 회원으로 인증해 Spring Authorization Server에 넘기고, 로그인하지 않았으면 프런트 로그인(next=이 주소)으로,
 * operator가 아니면 Langfuse로 access_denied를 돌려보낸다. authorize 외 OIDC 요청은 건드리지 않는다.
 */
class OidcAuthorizeFilter(private val sessions: SessionService, private val props: OidcProperties) : OncePerRequestFilter() {
    override fun shouldNotFilter(request: HttpServletRequest): Boolean = request.requestURI != AUTHORIZE_PATH

    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        val member = sessions.verifyRefreshToken(request.cookies?.firstOrNull { it.name == "refresh_token" }?.value)
        when {
            member == null -> redirect(response, "${props.loginUrl}?next=${UriUtils.encode(next(request), Charsets.UTF_8)}")
            !member.operator -> deny(request, response)
            else -> {
                // sub는 principal 이름(회원 UUID)이다. auth_time·sid가 FactorGrantedAuthority를 요구하므로 비밀번호 요소를 단다.
                val authentication = UsernamePasswordAuthenticationToken.authenticated(member.id, null,
                    listOf(FactorGrantedAuthority.fromAuthority(FactorGrantedAuthority.PASSWORD_AUTHORITY))).also { it.details = member }
                SecurityContextHolder.setContext(SecurityContextHolder.createEmptyContext().also { it.authentication = authentication })
                chain.doFilter(request, response)
            }
        }
    }

    /** 로그인 뒤 돌아올 authorize 경로+쿼리(원래 요청 주소). */
    private fun next(request: HttpServletRequest): String = request.requestURI + (request.queryString?.let { "?$it" } ?: "")

    /** 등록된 클라이언트·redirect_uri와 정확히 같은 요청에만 access_denied를 redirect로 돌려주고, 그 밖은 redirect 없이 400이다. */
    private fun deny(request: HttpServletRequest, response: HttpServletResponse) {
        val redirectUri = request.getParameter("redirect_uri")
        if (request.getParameter("client_id") != props.clientId || (redirectUri != null && redirectUri != props.redirectUri)) {
            response.sendError(HttpServletResponse.SC_BAD_REQUEST)
            return
        }
        val builder = UriComponentsBuilder.fromUriString(props.redirectUri).queryParam("error", "access_denied")
        request.getParameter("state")?.takeIf { it.isNotEmpty() }?.let { builder.queryParam("state", UriUtils.encode(it, Charsets.UTF_8)) }
        redirect(response, builder.build(true).toUriString())
    }

    private fun redirect(response: HttpServletResponse, location: String) {
        response.status = HttpServletResponse.SC_FOUND
        response.setHeader(HttpHeaders.LOCATION, location)
    }
}
