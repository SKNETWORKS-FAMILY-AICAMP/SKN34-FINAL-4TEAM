package ai.storyfork.core.auth

import ai.storyfork.core.auth.config.OIDC_PATH
import ai.storyfork.core.auth.config.OidcAuthorizeFilter
import ai.storyfork.core.auth.config.OidcMountFilter
import ai.storyfork.core.auth.config.OidcProperties
import ai.storyfork.core.auth.service.SessionService
import ai.storyfork.core.auth.service.dto.MemberResponse
import jakarta.servlet.FilterChain
import jakarta.servlet.http.Cookie
import jakarta.servlet.http.HttpServletRequest
import java.util.UUID
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.verify
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`
import org.springframework.http.HttpMethod
import org.springframework.mock.web.MockFilterChain
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.security.core.Authentication
import org.springframework.security.core.authority.FactorGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher

class OidcAuthorizeFilterTest {
    private val sessions = mock(SessionService::class.java)
    private val props = OidcProperties("https://core.example.test$OIDC_PATH", "pem", "langfuse", "secret",
        "https://langfuse.example.test/api/auth/callback/custom", "/login")
    private val filter = OidcAuthorizeFilter(sessions, props)
    private val operator = MemberResponse(UUID.randomUUID().toString(), "ops@example.test", "운영자", true)
    private val reader = MemberResponse(UUID.randomUUID().toString(), "reader@example.test", "독자", false)

    @AfterEach
    fun clearContext() = SecurityContextHolder.clearContext()

    private fun authorize(cookie: String? = "good-token", query: String = "client_id=langfuse&scope=openid%20email&state=xyz"): MockHttpServletRequest =
        MockHttpServletRequest("GET", "$OIDC_PATH/authorize").apply {
            requestURI = "$OIDC_PATH/authorize"
            queryString = query
            query.split("&").forEach { addParameter(it.substringBefore("="), it.substringAfter("=").replace("%20", " ")) }
            if (cookie != null) setCookies(Cookie("refresh_token", cookie))
        }

    @Test
    fun `a missing or invalid refresh cookie goes to the login page with the authorize address as next`() {
        `when`(sessions.verifyRefreshToken("stale-token")).thenReturn(null)
        val expected = "/login?next=%2Fapi%2Fv1%2Fauth%2Foidc%2Fauthorize%3Fclient_id%3Dlangfuse%26scope%3Dopenid%2520email%26state%3Dxyz"

        for (cookie in listOf(null, "stale-token")) {
            val response = MockHttpServletResponse()
            val chain = MockFilterChain()

            filter.doFilter(authorize(cookie), response, chain)

            assertEquals(302, response.status, cookie)
            assertEquals(expected, response.getHeader("Location"), cookie)
            assertNull(chain.request, "authorize must not continue unauthenticated")
        }
        verify(sessions).verifyRefreshToken(null)
        verify(sessions).verifyRefreshToken("stale-token")
    }

    @Test
    fun `a configured absolute login address is used as is`() {
        val absolute = OidcAuthorizeFilter(sessions, OidcProperties(props.issuer, "pem", "langfuse", "secret", props.redirectUri, "https://app.example.test/login"))
        val response = MockHttpServletResponse()

        absolute.doFilter(authorize(cookie = null, query = "client_id=langfuse"), response, MockFilterChain())

        assertEquals("https://app.example.test/login?next=%2Fapi%2Fv1%2Fauth%2Foidc%2Fauthorize%3Fclient_id%3Dlangfuse", response.getHeader("Location"))
    }

    @Test
    fun `an operator is authenticated as the member with a password factor and the request continues`() {
        `when`(sessions.verifyRefreshToken("good-token")).thenReturn(operator)
        val response = MockHttpServletResponse()
        var seen: Authentication? = null
        val chain = FilterChain { _, _ -> seen = SecurityContextHolder.getContext().authentication }

        filter.doFilter(authorize(), response, chain)

        val principal = requireNotNull(seen)
        assertTrue(principal.isAuthenticated)
        assertEquals(operator.id, principal.name)
        assertSame(operator, principal.details)
        assertTrue(principal.authorities.any { it is FactorGrantedAuthority && it.authority == FactorGrantedAuthority.PASSWORD_AUTHORITY })
        assertEquals(200, response.status)
        assertNull(response.getHeader("Location"))
    }

    @Test
    fun `a non operator is sent back to Langfuse with access_denied and the state, without a code`() {
        `when`(sessions.verifyRefreshToken("good-token")).thenReturn(reader)
        val request = authorize(query = "client_id=langfuse&redirect_uri=https://langfuse.example.test/api/auth/callback/custom&state=a%20b%26c")
        request.setParameter("state", "a b&c")
        val response = MockHttpServletResponse()
        val chain = MockFilterChain()

        filter.doFilter(request, response, chain)

        assertEquals(302, response.status)
        assertEquals("https://langfuse.example.test/api/auth/callback/custom?error=access_denied&state=a%20b%26c", response.getHeader("Location"))
        assertNull(chain.request)
        assertNull(SecurityContextHolder.getContext().authentication)
    }

    @Test
    fun `a non operator denial never redirects to an unregistered client or redirect address`() {
        `when`(sessions.verifyRefreshToken("good-token")).thenReturn(reader)
        for (query in listOf("client_id=other&state=s", "client_id=langfuse&redirect_uri=https://evil.example.test/cb&state=s")) {
            val response = MockHttpServletResponse()
            val chain = MockFilterChain()

            filter.doFilter(authorize(query = query), response, chain)

            assertEquals(400, response.status, query)
            assertNull(response.getHeader("Location"), query)
            assertNull(chain.request, query)
        }
    }

    @Test
    fun `only the authorize endpoint is handled and other OIDC requests pass through untouched`() {
        for (path in listOf("$OIDC_PATH/token", "$OIDC_PATH/jwks", "$OIDC_PATH/userinfo", "$OIDC_PATH/.well-known/openid-configuration")) {
            val request = MockHttpServletRequest("GET", path).apply { requestURI = path }
            val chain = MockFilterChain()

            filter.doFilter(request, MockHttpServletResponse(), chain)

            assertSame(request, chain.request, path)
        }
        verifyNoInteractions(sessions)
    }

    @Test
    fun `the mount filter makes the OIDC path act as the context path so endpoints resolve under the issuer path`() {
        val authorize = PathPatternRequestMatcher.withDefaults().matcher(HttpMethod.GET, "/authorize")
        val discovery = PathPatternRequestMatcher.withDefaults().matcher(HttpMethod.GET, "/.well-known/openid-configuration")
        val raw = MockHttpServletRequest("GET", "$OIDC_PATH/authorize").apply { requestURI = "$OIDC_PATH/authorize" }
        assertFalse(authorize.matches(raw), "without mounting the endpoint would be served at the root")
        val chain = MockFilterChain()

        OidcMountFilter().doFilter(raw, MockHttpServletResponse(), chain)

        val mounted = chain.request as HttpServletRequest
        assertTrue(authorize.matches(mounted))
        val wellKnown = MockHttpServletRequest("GET", "$OIDC_PATH/.well-known/openid-configuration").apply { requestURI = "$OIDC_PATH/.well-known/openid-configuration" }
        val mountedWellKnown = MockFilterChain().also { OidcMountFilter().doFilter(wellKnown, MockHttpServletResponse(), it) }.request as HttpServletRequest
        assertTrue(discovery.matches(mountedWellKnown))
        // 원래 요청 주소는 그대로라 로그인 복귀 주소(next)에 쓸 수 있다.
        assertEquals("$OIDC_PATH/authorize", mounted.requestURI)
    }
}
