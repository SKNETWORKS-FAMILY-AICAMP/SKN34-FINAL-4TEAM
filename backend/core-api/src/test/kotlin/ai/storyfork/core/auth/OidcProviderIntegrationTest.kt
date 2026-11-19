package ai.storyfork.core.auth

import ai.storyfork.core._health.controller.HealthController
import ai.storyfork.core.auth.config.AuthSecurityConfig
import ai.storyfork.core.auth.config.OidcProperties
import ai.storyfork.core.auth.config.OidcSecurityConfig
import ai.storyfork.core.auth.service.SessionService
import ai.storyfork.core.auth.service.dto.MemberResponse
import com.nimbusds.jose.crypto.RSASSAVerifier
import com.nimbusds.jose.jwk.JWKSet
import com.nimbusds.jwt.SignedJWT
import jakarta.servlet.http.Cookie
import java.nio.charset.StandardCharsets
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.time.Instant
import java.util.Base64
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.Mockito.`when`
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.context.annotation.Import
import org.springframework.http.MediaType
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
import org.springframework.security.oauth2.jose.jws.MacAlgorithm
import org.springframework.security.oauth2.jwt.JwsHeader
import org.springframework.security.oauth2.jwt.JwtClaimsSet
import org.springframework.security.oauth2.jwt.JwtEncoder
import org.springframework.security.oauth2.jwt.JwtEncoderParameters
import org.springframework.security.web.SecurityFilterChain
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.web.util.UriComponentsBuilder
import tools.jackson.databind.json.JsonMapper

/**
 * Langfuse OIDC 제공자(DEC-55)를 실제 Spring Authorization Server 체인으로 확인한다: 디스커버리·JWKS, authorize 로그인 확인,
 * 인가 코드 + PKCE → 토큰(RS256 ID 토큰·claim) → userinfo, 비운영자 거절, 회원 JWT(HS256) 분리, 설정이 비면 제공자가 빠짐.
 * 서명 키는 실행 때 만든다. SessionService는 대역이라 refresh 쿠키 "operator-token"·"reader-token"만 로그인으로 본다.
 */
@WebMvcTest(controllers = [HealthController::class], properties = ["AUTH_JWT_SECRET=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="])
@Import(AuthSecurityConfig::class, OidcSecurityConfig::class, OidcProviderIntegrationTest.Security::class)
class OidcProviderIntegrationTest {
    @TestConfiguration(proxyBeanMethods = false)
    @EnableWebSecurity
    class Security

    companion object {
        private const val ISSUER = "https://core.example.test/api/v1/auth/oidc"
        private const val REDIRECT = "https://langfuse.example.test/api/auth/callback/custom"
        private const val SECRET = "ci-langfuse-client-secret"

        // 프로퍼티 값은 읽을 때마다 공급자가 불리므로 키는 한 번만 만든다.
        private val SIGNING_KEY_PEM: String = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair().let { pair ->
            val body = Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(pair.private.encoded)
            "-----BEGIN PRIVATE KEY-----\n$body\n-----END PRIVATE KEY-----\n"
        }

        @JvmStatic
        @DynamicPropertySource
        fun oidcProperties(registry: DynamicPropertyRegistry) {
            registry.add("app.auth.oidc.issuer") { ISSUER }
            registry.add("app.auth.oidc.signing-key") { SIGNING_KEY_PEM }
            registry.add("app.auth.oidc.client-id") { "langfuse" }
            registry.add("app.auth.oidc.client-secret") { SECRET }
            registry.add("app.auth.oidc.redirect-uri") { REDIRECT }
            registry.add("app.auth.oidc.login-url") { "/login" }
        }
    }

    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var memberJwtEncoder: JwtEncoder
    @MockitoBean lateinit var sessions: SessionService

    private val json = JsonMapper.builder().build()
    private val operator = MemberResponse(UUID.randomUUID().toString(), "ops@example.test", "운영자", true)
    private val reader = MemberResponse(UUID.randomUUID().toString(), "reader@example.test", "독자", false)

    private fun challenge(verifier: String) = Base64.getUrlEncoder().withoutPadding()
        .encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(StandardCharsets.US_ASCII)))

    private fun authorize(verifier: String, cookie: String?): MockHttpServletResponse {
        val request = get("/api/v1/auth/oidc/authorize").queryParam("response_type", "code").queryParam("client_id", "langfuse")
            .queryParam("redirect_uri", REDIRECT).queryParam("scope", "openid email profile").queryParam("state", "st-1")
            .queryParam("nonce", "nonce-1").queryParam("code_challenge", challenge(verifier)).queryParam("code_challenge_method", "S256")
        if (cookie != null) request.cookie(Cookie("refresh_token", cookie))
        return mvc.perform(request).andReturn().response
    }

    private fun tokens(code: String, verifier: String, secret: String = SECRET) = mvc.perform(post("/api/v1/auth/oidc/token")
        .header("Authorization", "Basic " + Base64.getEncoder().encodeToString("langfuse:$secret".toByteArray()))
        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
        .param("grant_type", "authorization_code").param("code", code).param("redirect_uri", REDIRECT).param("code_verifier", verifier))

    private fun publicKey() = JWKSet.parse(mvc.perform(get("/api/v1/auth/oidc/jwks")).andExpect(status().isOk()).andReturn().response.contentAsString)
        .keys.single().toRSAKey().toRSAPublicKey()

    @Test fun `the discovery document advertises every endpoint under the issuer path`() {
        mvc.perform(get("/api/v1/auth/oidc/.well-known/openid-configuration")).andExpect(status().isOk())
            .andExpect(jsonPath("$.issuer").value(ISSUER))
            .andExpect(jsonPath("$.authorization_endpoint").value("$ISSUER/authorize"))
            .andExpect(jsonPath("$.token_endpoint").value("$ISSUER/token"))
            .andExpect(jsonPath("$.jwks_uri").value("$ISSUER/jwks"))
            .andExpect(jsonPath("$.userinfo_endpoint").value("$ISSUER/userinfo"))
            .andExpect(jsonPath("$.id_token_signing_alg_values_supported[0]").value("RS256"))
            .andExpect(jsonPath("$.code_challenge_methods_supported[0]").value("S256"))
    }

    @Test fun `the JWKS publishes a single public RS256 key`() {
        val keys = JWKSet.parse(mvc.perform(get("/api/v1/auth/oidc/jwks")).andExpect(status().isOk()).andReturn().response.contentAsString).keys
        assertEquals(1, keys.size)
        assertEquals("RSA", keys.single().keyType.value)
        assertFalse(keys.single().isPrivate)
        assertNotNull(keys.single().keyID)
    }

    @Test fun `authorize without a valid refresh cookie goes to the login page`() {
        `when`(sessions.verifyRefreshToken("stale-token")).thenReturn(null)
        for (cookie in listOf(null, "stale-token")) {
            val response = authorize("v".repeat(43), cookie)
            assertEquals(302, response.status, cookie)
            assertTrue(response.getHeader("Location")!!.startsWith("/login?next=%2Fapi%2Fv1%2Fauth%2Foidc%2Fauthorize%3F"), cookie)
        }
    }

    @Test fun `an operator gets a code with PKCE and exchanges it for a verifiable ID token and userinfo`() {
        `when`(sessions.verifyRefreshToken("operator-token")).thenReturn(operator)
        val verifier = "operator-code-verifier-0123456789-abcdefghijklmnop"
        val redirect = authorize(verifier, "operator-token").getHeader("Location")!!
        assertTrue(redirect.startsWith("$REDIRECT?code="), redirect)
        val query = UriComponentsBuilder.fromUriString(redirect).build().queryParams
        assertEquals("st-1", query.getFirst("state"))

        val body = json.readTree(tokens(query.getFirst("code")!!, verifier).andExpect(status().isOk()).andReturn().response.contentAsString)

        // ID 토큰: JWKS의 공개키로 RS256 서명이 맞고 회원 claim이 들어 있다. sub는 회원 UUID다.
        val idToken = SignedJWT.parse(body.path("id_token").asString())
        assertEquals("RS256", idToken.header.algorithm.name)
        assertTrue(idToken.verify(RSASSAVerifier(publicKey())))
        val claims = idToken.jwtClaimsSet
        assertEquals(ISSUER, claims.issuer)
        assertEquals(operator.id, claims.subject)
        assertEquals(listOf("langfuse"), claims.audience)
        assertEquals("ops@example.test", claims.getStringClaim("email"))
        assertEquals(true, claims.getBooleanClaim("email_verified"))
        assertEquals("운영자", claims.getStringClaim("name"))
        assertEquals("nonce-1", claims.getStringClaim("nonce"))
        assertNotNull(claims.getDateClaim("auth_time"))
        assertTrue(claims.expirationTime.toInstant().isAfter(Instant.now()))

        mvc.perform(get("/api/v1/auth/oidc/userinfo").header("Authorization", "Bearer " + body.path("access_token").asString()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.sub").value(operator.id))
            .andExpect(jsonPath("$.email").value("ops@example.test"))
            .andExpect(jsonPath("$.name").value("운영자"))
    }

    @Test fun `a code cannot be redeemed with a wrong client secret or a wrong PKCE verifier`() {
        `when`(sessions.verifyRefreshToken("operator-token")).thenReturn(operator)
        val verifier = "operator-code-verifier-0123456789-abcdefghijklmnop"
        val code = UriComponentsBuilder.fromUriString(authorize(verifier, "operator-token").getHeader("Location")!!).build().queryParams.getFirst("code")!!

        tokens(code, verifier, secret = "wrong-secret").andExpect(status().isUnauthorized())
        tokens(code, "z".repeat(43)).andExpect(status().isBadRequest())
    }

    @Test fun `a non operator is sent back to Langfuse with access_denied and no code`() {
        `when`(sessions.verifyRefreshToken("reader-token")).thenReturn(reader)

        val location = authorize("v".repeat(43), "reader-token").getHeader("Location")!!

        assertTrue(location.startsWith("$REDIRECT?error=access_denied"), location)
        assertEquals("st-1", UriComponentsBuilder.fromUriString(location).build().queryParams.getFirst("state"))
        assertFalse(location.contains("code="))
    }

    @Test fun `the member JWT (HS256) is not accepted as a userinfo bearer token`() {
        val now = Instant.now()
        val claims = JwtClaimsSet.builder().subject(operator.id).issuedAt(now).expiresAt(now.plusSeconds(60)).build()
        val memberToken = memberJwtEncoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).tokenValue

        mvc.perform(get("/api/v1/auth/oidc/userinfo").header("Authorization", "Bearer $memberToken")).andExpect(status().isUnauthorized())
        mvc.perform(get("/api/v1/auth/oidc/userinfo")).andExpect(status().isUnauthorized())
    }

    @Test fun `the provider is absent without an issuer and refuses to start with an incomplete configuration`() {
        val runner = ApplicationContextRunner().withUserConfiguration(OidcSecurityConfig::class.java)
        for (issuer in listOf(null, "")) {
            (if (issuer == null) runner else runner.withPropertyValues("app.auth.oidc.issuer=$issuer")).run { context ->
                assertEquals(null, context.startupFailure)
                assertTrue(context.getBeansOfType(SecurityFilterChain::class.java).isEmpty())
                assertTrue(context.getBeansOfType(OidcProperties::class.java).isEmpty())
            }
        }
        // 운영 설정에서는 application.properties가 빈 문자열을 채워 주므로 같은 상태를 재현한다.
        runner.withPropertyValues("app.auth.oidc.issuer=$ISSUER", "app.auth.oidc.signing-key=", "app.auth.oidc.client-id=",
            "app.auth.oidc.client-secret=", "app.auth.oidc.redirect-uri=", "app.auth.oidc.login-url=/login").run { context ->
            val failure = requireNotNull(context.startupFailure)
            assertTrue(generateSequence<Throwable>(failure) { it.cause }.any { it.message?.contains("AUTH_OIDC_SIGNING_KEY") == true })
        }
    }
}
