package ai.storyfork.core.content

import ai.storyfork.core.auth.config.AuthSecurityConfig
import ai.storyfork.core._common.config.WebCorsConfig
import ai.storyfork.core.work.controller.WorkController
import ai.storyfork.core.work.service.WorkService
import ai.storyfork.core.episode.controller.EpisodeController
import ai.storyfork.core.episode.service.EpisodeService
import ai.storyfork.core.episode_version.controller.EpisodeVersionController
import ai.storyfork.core.episode_version.service.EpisodeVersionService
import ai.storyfork.core.publication.controller.PublicationController
import ai.storyfork.core.publication.service.PublicationService
import ai.storyfork.core.work.service.dto.WorkListResponse
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.context.annotation.Import
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.security.oauth2.jwt.*
import org.mockito.Mockito.*
import jakarta.servlet.http.Cookie
import java.time.Instant

@WebMvcTest(controllers=[WorkController::class,EpisodeController::class,EpisodeVersionController::class,PublicationController::class,ai.storyfork.core.context.controller.ContextController::class],properties=["app.content.enabled=true","app.cors.allowed-origin=http://localhost:5173","AUTH_JWT_SECRET=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="])
@Import(AuthSecurityConfig::class,WebCorsConfig::class,ContentAuthorizationTest.MvcSecurity::class)
class ContentAuthorizationTest {
    @org.springframework.boot.test.context.TestConfiguration(proxyBeanMethods=false)
    @org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
    class MvcSecurity

    private fun csrfValue(): String {
        val request=org.springframework.mock.web.MockHttpServletRequest()
        val response=org.springframework.mock.web.MockHttpServletResponse()
        val token=org.springframework.security.web.csrf.DefaultCsrfToken("X-CSRF-TOKEN","_csrf","test-csrf")
        org.springframework.security.web.csrf.XorCsrfTokenRequestAttributeHandler().handle(request,response) {token}
        return (request.getAttribute(org.springframework.security.web.csrf.CsrfToken::class.java.name) as org.springframework.security.web.csrf.CsrfToken).token
    }

    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var encoder: JwtEncoder
    @MockitoBean lateinit var works: WorkService
    @MockitoBean lateinit var episodes: EpisodeService
    @MockitoBean lateinit var versions: EpisodeVersionService
    @MockitoBean lateinit var publication: PublicationService
    @MockitoBean lateinit var context: ai.storyfork.core.context.service.ContextService
    private fun token(): String = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(org.springframework.security.oauth2.jose.jws.MacAlgorithm.HS256).build(),JwtClaimsSet.builder().subject("verified-user").issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(600)).build())).tokenValue
    private fun mutation(path: String) = post(path).cookie(Cookie("XSRF-TOKEN","test-csrf")).header("X-CSRF-TOKEN",csrfValue()).contentType("application/json")

    @Test fun `browser demo identity and forged headers cannot authorize`() {
        mvc.perform(get("/api/v1/works").header("X-User-Id","me")).andExpect(status().isUnauthorized())
        verifyNoInteractions(works,episodes,versions,publication)
    }
    @Test fun `episode mutations require server authentication and validate input`() {
        val base="/api/v1/works/work-id/episodes"
        for(path in listOf(base,base+"/1/versions",base+"/1/restore",base+"/1/publish")) {
            mvc.perform(mutation(path).content("""{"title":"회차","body":"원고","revision":0,"versionId":"v1","rightsConfirmed":true}""")).andExpect(status().isUnauthorized())
        }
        mvc.perform(put(base+"/1/draft").cookie(Cookie("XSRF-TOKEN","test-csrf")).header("X-CSRF-TOKEN",csrfValue()).contentType("application/json").content("""{"title":"회차","body":"원고","revision":0}""")).andExpect(status().isUnauthorized())
        mvc.perform(get(base+"/1")).andExpect(status().isUnauthorized())
        mvc.perform(put(base+"/1/draft").header("Authorization","Bearer "+token()).cookie(Cookie("XSRF-TOKEN","test-csrf")).header("X-CSRF-TOKEN",csrfValue()).contentType("application/json").content("""{"title":"","body":"원고","revision":0}""")).andExpect(status().isUnprocessableEntity())
        verifyNoInteractions(works,episodes,versions,publication)
    }
    @Test fun `only authenticated principal determines owner`() {
        `when`(works.list("verified-user")).thenReturn(WorkListResponse(emptyList()))
        mvc.perform(get("/api/v1/works").header("Authorization","Bearer "+token()).header("X-User-Id","forged")).andExpect(status().isOk())
        verify(works).list("verified-user")
    }
    @Test fun `foreign origin cannot write even with principal`() {
        mvc.perform(mutation("/api/v1/works").header("Authorization","Bearer "+token()).header("Origin","https://evil.example").content("""{"title":"test"}""")).andExpect(status().isForbidden())
        verifyNoInteractions(works,episodes,versions,publication)
    }
    @Test fun `missing context episode and malformed JSON keep HTTP binding errors`() {
        mvc.perform(get("/api/v1/works/work-id/context").header("Authorization","Bearer "+token())).andExpect(status().isBadRequest())
        mvc.perform(get("/api/v1/works/work-id/context?episode=abc").header("Authorization","Bearer "+token())).andExpect(status().isBadRequest())
        mvc.perform(mutation("/api/v1/works").header("Authorization","Bearer "+token()).content("{broken")).andExpect(status().isBadRequest())
        verifyNoInteractions(works,context)
    }
    @Test fun `authenticated mutations still require csrf`() {
        mvc.perform(post("/api/v1/works").header("Authorization","Bearer "+token()).contentType("application/json").content("""{"title":"test"}""")).andExpect(status().isForbidden())
        verifyNoInteractions(works,episodes,versions,publication)
    }
}
