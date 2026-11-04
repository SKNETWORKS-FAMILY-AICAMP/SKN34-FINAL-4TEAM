package ai.storyfork.content.fixture

/** HTTP 통합 테스트에서 Core가 발급한 것과 같은 cookie/header 쌍을 생성한다. 인증은 별도 대역/시스템에서 검증한다. */
object CsrfFixture {
    const val raw="content-test-csrf"
    const val cookie="XSRF-TOKEN=$raw"
    fun token(): String {
        val request=org.springframework.mock.web.MockHttpServletRequest()
        val response=org.springframework.mock.web.MockHttpServletResponse()
        val csrf=org.springframework.security.web.csrf.DefaultCsrfToken("X-CSRF-TOKEN","_csrf",raw)
        org.springframework.security.web.csrf.XorCsrfTokenRequestAttributeHandler().handle(request,response) { csrf }
        return (request.getAttribute(org.springframework.security.web.csrf.CsrfToken::class.java.name) as org.springframework.security.web.csrf.CsrfToken).token
    }
}
