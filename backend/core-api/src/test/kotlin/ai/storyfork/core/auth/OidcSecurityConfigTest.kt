package ai.storyfork.core.auth

import ai.storyfork.core.auth.config.OIDC_PATH
import ai.storyfork.core.auth.config.OidcEnabledCondition
import ai.storyfork.core.auth.config.OidcProperties
import ai.storyfork.core.auth.config.langfuseClient
import ai.storyfork.core.auth.config.oidcAuthorizationServerSettings
import ai.storyfork.core.auth.config.oidcMemberClaims
import ai.storyfork.core.auth.config.rsaJwkFromPem
import ai.storyfork.core.auth.service.dto.MemberResponse
import java.security.KeyPairGenerator
import java.security.interfaces.RSAPublicKey
import java.util.Base64
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.springframework.context.annotation.ConditionContext
import org.springframework.core.type.AnnotatedTypeMetadata
import org.springframework.mock.env.MockEnvironment
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.FactorGrantedAuthority
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.security.oauth2.core.AuthorizationGrantType
import org.springframework.security.oauth2.core.ClientAuthenticationMethod
import org.springframework.security.oauth2.core.oidc.OidcScopes
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm
import org.springframework.security.oauth2.jwt.JwsHeader
import org.springframework.security.oauth2.jwt.JwtClaimsSet
import org.springframework.security.oauth2.server.authorization.OAuth2TokenType
import org.springframework.security.oauth2.server.authorization.token.JwtEncodingContext

class OidcSecurityConfigTest {
    private val issuer = "https://core.example.test$OIDC_PATH"
    private val redirect = "https://langfuse.example.test/api/auth/callback/custom"
    private fun props(issuer: String = this.issuer, key: String = "pem", id: String = "langfuse", secret: String = "client-secret",
        redirectUri: String = redirect, login: String = "/login") = OidcProperties(issuer, key, id, secret, redirectUri, login)

    private fun condition(issuer: String?): Boolean {
        val context = mock(ConditionContext::class.java)
        `when`(context.environment).thenReturn(MockEnvironment().also { if (issuer != null) it.setProperty("app.auth.oidc.issuer", issuer) })
        return OidcEnabledCondition().matches(context, mock(AnnotatedTypeMetadata::class.java))
    }

    @Test
    fun `the provider is off unless the issuer is set, so local and CI start without any OIDC env`() {
        assertFalse(condition(null))
        assertFalse(condition(""))
        assertFalse(condition("   "))
        assertTrue(condition(issuer))
    }

    @Test
    fun `enabled configuration must be complete and the issuer path must be the OIDC path`() {
        assertEquals("OidcProperties(issuer=$issuer, clientId=langfuse)", props().toString())
        for (bad in listOf(
            {props(issuer = "https://core.example.test")}, {props(issuer = "https://core.example.test$OIDC_PATH/")},
            {props(issuer = "ftp://core.example.test$OIDC_PATH")}, {props(issuer = "$issuer?x=1")}, {props(issuer = "not a url")},
            {props(key = " ")}, {props(id = "")}, {props(secret = "")}, {props(redirectUri = "")}, {props(redirectUri = "/relative")},
            {props(secret = "가".repeat(25))}, {props(login = "")},
        )) assertThrows(IllegalArgumentException::class.java) { bad() }
    }

    private fun pemOf(bits: Int): Pair<String, RSAPublicKey> {
        val pair = KeyPairGenerator.getInstance("RSA").apply { initialize(bits) }.generateKeyPair()
        val body = Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(pair.private.encoded)
        return "-----BEGIN PRIVATE KEY-----\n$body\n-----END PRIVATE KEY-----\n" to pair.public as RSAPublicKey
    }

    @Test
    fun `a PKCS8 PEM becomes a stable RS256 signing JWK whose public part is published`() {
        val (pem, publicKey) = pemOf(2048)

        for (variant in listOf(pem, pem.replace("\n", "\\n"), pem.lines().filter { !it.startsWith("-----") }.joinToString(""))) {
            val jwk = rsaJwkFromPem(variant)
            assertEquals(publicKey.modulus, jwk.toRSAPublicKey().modulus)
            assertTrue(jwk.isPrivate)
            assertEquals(jwk.computeThumbprint().toString(), jwk.keyID)
            assertFalse(jwk.toPublicJWK().toJSONObject().containsKey("d"))
        }
    }

    @Test
    fun `a signing key shorter than 2048 bits is refused`() {
        assertThrows(IllegalArgumentException::class.java) { rsaJwkFromPem(pemOf(1024).first) }
    }

    @Test
    fun `Langfuse is the only client with code plus PKCE, no consent and a hashed secret`() {
        val passwords = BCryptPasswordEncoder(4)

        val client = langfuseClient(props(), passwords)

        assertEquals("langfuse", client.clientId)
        assertTrue(passwords.matches("client-secret", client.clientSecret))
        assertEquals(setOf(AuthorizationGrantType.AUTHORIZATION_CODE), client.authorizationGrantTypes)
        assertEquals(setOf(ClientAuthenticationMethod.CLIENT_SECRET_BASIC, ClientAuthenticationMethod.CLIENT_SECRET_POST), client.clientAuthenticationMethods)
        assertEquals(setOf(redirect), client.redirectUris)
        assertEquals(setOf(OidcScopes.OPENID, OidcScopes.EMAIL, OidcScopes.PROFILE), client.scopes)
        assertTrue(client.clientSettings.isRequireProofKey)
        assertFalse(client.clientSettings.isRequireAuthorizationConsent)
    }

    @Test
    fun `every endpoint sits under the issuer path`() {
        val settings = oidcAuthorizationServerSettings(props())

        assertEquals(issuer, settings.issuer)
        assertEquals("/authorize", settings.authorizationEndpoint)
        assertEquals("/token", settings.tokenEndpoint)
        assertEquals("/jwks", settings.jwkSetEndpoint)
        assertEquals("/userinfo", settings.oidcUserInfoEndpoint)
    }

    private val member = MemberResponse(UUID.randomUUID().toString(), "ops@example.test", "운영자", true)

    private fun context(type: String): JwtEncodingContext {
        val principal = UsernamePasswordAuthenticationToken.authenticated(member.id, null, listOf(FactorGrantedAuthority.fromAuthority(FactorGrantedAuthority.PASSWORD_AUTHORITY)))
            .also { it.details = member }
        return JwtEncodingContext.with(JwsHeader.with(SignatureAlgorithm.RS256), JwtClaimsSet.builder().subject(member.id))
            .principal(principal).tokenType(OAuth2TokenType(type)).build()
    }

    @Test
    fun `the ID token carries the member email, verified flag and nickname as name, while sub stays the member UUID`() {
        val context = context("id_token")

        oidcMemberClaims().customize(context)

        val claims = context.claims.build().claims
        assertEquals(member.id, claims["sub"])
        assertEquals("ops@example.test", claims["email"])
        assertEquals(true, claims["email_verified"])
        assertEquals("운영자", claims["name"])
    }

    @Test
    fun `the access token does not get member claims`() {
        val context = context("access_token")

        oidcMemberClaims().customize(context)

        val claims = context.claims.build().claims
        assertNull(claims["email"])
        assertNull(claims["name"])
    }
}
