package ai.storyfork.core.auth

import jakarta.servlet.http.Cookie
import java.util.UUID
import java.time.Instant
import org.springframework.security.oauth2.jose.jws.MacAlgorithm
import org.springframework.security.oauth2.jwt.JwsHeader
import org.springframework.security.oauth2.jwt.JwtClaimsSet
import org.springframework.security.oauth2.jwt.JwtEncoder
import org.springframework.security.oauth2.jwt.JwtEncoderParameters
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

@SpringBootTest
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named = "AUTH_INTEGRATION_TEST", matches = "true")
class SessionIntegrationTest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var jwt: JwtEncoder

    private fun secured(path: String): MockHttpServletRequestBuilder {
        val response = mvc.perform(get("/api/v1/auth/csrf")).andReturn().response
        val token = response.contentAsString.substringAfter("\"csrfToken\":\"").substringBefore('"')
        return post(path).cookie(requireNotNull(response.getCookie("XSRF-TOKEN"))).header("X-CSRF-TOKEN", token)
    }

    private fun securedDelete(path: String): MockHttpServletRequestBuilder {
        val response = mvc.perform(get("/api/v1/auth/csrf")).andReturn().response
        val token = response.contentAsString.substringAfter("\"csrfToken\":\"").substringBefore('"')
        return delete(path).cookie(requireNotNull(response.getCookie("XSRF-TOKEN"))).header("X-CSRF-TOKEN", token)
    }

    private fun access(result: MvcResult): String =
        result.response.contentAsString.substringAfter("\"accessToken\":\"").substringBefore('"')

    private fun member(): String {
        val email = "${UUID.randomUUID()}@example.invalid"
        jdbc.update("insert into auth_member(id, email, password_hash, nickname) values (?, ?, ?, ?)",
            UUID.randomUUID(), email, BCryptPasswordEncoder().encode("test-password"), "Reader")
        return email
    }

    private fun login(email: String, password: String = "test-password"): MvcResult =
        mvc.perform(secured("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
            .content("""{"email":"$email","password":"$password"}""")).andReturn()

    private fun refreshCookie(result: MvcResult): Cookie {
        val header = requireNotNull(result.response.getHeaders("Set-Cookie").find { it.startsWith("refresh_token=") })
        assertTrue(header.contains("HttpOnly", ignoreCase = true))
        assertTrue(header.contains("SameSite=Strict", ignoreCase = true))
        assertTrue(header.contains("Path=/api/v1/auth", ignoreCase = true))
        assertEquals(System.getenv("AUTH_COOKIE_SECURE") != "false", header.contains("; Secure", ignoreCase = true))
        return Cookie("refresh_token", header.substringAfter('=').substringBefore(';'))
    }

    private fun refresh(cookie: Cookie): MvcResult =
        mvc.perform(secured("/api/v1/auth/refresh").cookie(cookie)).andReturn()

    @Test
    fun `login does not reveal whether an email exists and requires csrf`() {
        val email = member()
        val known = login(email, "incorrect").response
        val unknown = login("${UUID.randomUUID()}@example.invalid", "incorrect").response
        assertTrue(known.status in 400..499)
        assertEquals(known.status, unknown.status)
        assertEquals(known.contentAsString, unknown.contentAsString)
        mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
            .content("""{"email":"$email","password":"test-password"}"""))
            .andExpect(status().isForbidden())
        val success = login(email)
        assertEquals(200, success.response.status)
        refreshCookie(success)
        assertTrue(success.response.contentAsString.contains("\"accessToken\""))
    }

    @Test
    fun `refresh rotates token and reuse revokes every session`() {
        val email = member()
        val first = refreshCookie(login(email))
        val secondSession = refreshCookie(login(email))
        val rotated = refresh(first)
        assertEquals(200, rotated.response.status)
        val replacement = refreshCookie(rotated)
        assertNotEquals(first.value, replacement.value)
        assertTrue(refresh(first).response.status in 400..499)
        assertTrue(refresh(replacement).response.status in 400..499)
        assertTrue(refresh(secondSession).response.status in 400..499)
    }

    @Test
    fun `concurrent refresh reuse revokes the winning token`() {
        val old = refreshCookie(login(member()))
        val pool = Executors.newFixedThreadPool(2)
        try {
            val start = CountDownLatch(1)
            val jobs = (1..2).map { pool.submit<MvcResult> { start.await(); refresh(old) } }
            start.countDown()
            val results = jobs.map { it.get() }
            assertEquals(1, results.count { it.response.status == 200 })
            val replacement = refreshCookie(results.single { it.response.status == 200 })
            assertTrue(refresh(replacement).response.status in 400..499)
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun `session ownership current flag and logout are enforced`() {
        val owner = login(member())
        val ownerToken = access(owner)
        val cookie = refreshCookie(owner)
        val otherToken = access(login(member()))
        val sessions = mvc.perform(get("/api/v1/auth/sessions").cookie(cookie)
            .header("Authorization", "Bearer $ownerToken")).andExpect(status().isOk()).andReturn().response.contentAsString
        assertTrue(sessions.contains("\"current\":true"))
        val id = sessions.substringAfter("\"id\":\"").substringBefore('"')
        assertTrue(id.isNotBlank())
        mvc.perform(securedDelete("/api/v1/auth/sessions/$id").header("Authorization", "Bearer $otherToken"))
            .andExpect(status().is4xxClientError())
        mvc.perform(secured("/api/v1/auth/logout").cookie(cookie)).andExpect(status().isNoContent())
        assertTrue(refresh(cookie).response.status in 400..499)
    }

    @Test
    fun `owner can revoke their current session`() {
        val login = login(member())
        val cookie = refreshCookie(login)
        val bearer = "Bearer ${access(login)}"
        val body = mvc.perform(get("/api/v1/auth/sessions").cookie(cookie).header("Authorization", bearer))
            .andExpect(status().isOk()).andReturn().response.contentAsString
        val id = body.substringAfter("\"id\":\"").substringBefore('"')
        mvc.perform(securedDelete("/api/v1/auth/sessions/$id").header("Authorization", bearer))
            .andExpect(status().isNoContent())
        assertTrue(refresh(cookie).response.status in 400..499)
    }

    @Test
    fun `logout all revokes every refresh session`() {
        val email = member()
        val first = login(email)
        val second = login(email)
        mvc.perform(secured("/api/v1/auth/logout-all").header("Authorization", "Bearer ${access(first)}"))
            .andExpect(status().isNoContent())
        assertTrue(refresh(refreshCookie(first)).response.status in 400..499)
        assertTrue(refresh(refreshCookie(second)).response.status in 400..499)
    }

    @Test
    fun `logout is idempotent for missing invalid and expired refresh cookies`() {
        val email = member()
        val cookie = refreshCookie(login(email))
        jdbc.update("update auth_session set expires_at = now() - interval '1 second' where member_id = (select id from auth_member where email = ?)", email)
        assertTrue(refresh(cookie).response.status in 400..499)
        for (cookies in listOf(emptyArray(), arrayOf(Cookie("refresh_token", "unknown")), arrayOf(cookie))) {
            val response = mvc.perform(secured("/api/v1/auth/logout").apply { if (cookies.isNotEmpty()) cookie(*cookies) })
                .andExpect(status().isNoContent()).andReturn().response
            assertTrue(response.getHeaders("Set-Cookie").any { it.startsWith("refresh_token=") && it.contains("Max-Age=0") })
        }
    }

    @Test
    fun `stale account logout all preserves another account refresh cookie`() {
        val stale = login(member())
        val current = login(member())
        val response = mvc.perform(secured("/api/v1/auth/logout-all").cookie(refreshCookie(current))
            .header("Authorization", "Bearer ${access(stale)}"))
            .andExpect(status().isNoContent()).andReturn().response
        assertTrue(response.getHeaders("Set-Cookie").none { it.startsWith("refresh_token=") })
        assertEquals(401, refresh(refreshCookie(stale)).response.status)
        assertEquals(200, refresh(refreshCookie(current)).response.status)
    }

    @Test
    fun `bound refresh and logout cannot consume revoke or clear another account cookie`() {
        val stale = login(member())
        val expectedUser = stale.response.contentAsString.substringAfter("\"user\":{\"id\":\"").substringBefore('"')
        val other = login(member())
        val old = refreshCookie(other)
        val current = refreshCookie(refresh(old))
        for (cookie in listOf(current, old)) {
            for ((path, expectedStatus) in listOf("refresh" to 401, "logout" to 409)) {
                val response = mvc.perform(secured("/api/v1/auth/$path").cookie(cookie).header("X-Auth-User", expectedUser))
                    .andReturn().response
                assertEquals(expectedStatus, response.status)
                assertTrue(response.getHeaders("Set-Cookie").none { it.startsWith("refresh_token=") })
            }
        }
        assertEquals(200, refresh(current).response.status)
        assertEquals(200, refresh(refreshCookie(stale)).response.status)
    }

    @Test
    fun `logout all clears its own cookie and logout requires csrf even without a cookie`() {
        val owner = login(member())
        val response = mvc.perform(secured("/api/v1/auth/logout-all").cookie(refreshCookie(owner))
            .header("Authorization", "Bearer ${access(owner)}"))
            .andExpect(status().isNoContent()).andReturn().response
        assertTrue(response.getHeaders("Set-Cookie").any { it.startsWith("refresh_token=") && it.contains("Max-Age=0") })
        mvc.perform(post("/api/v1/auth/logout")).andExpect(status().isForbidden())
    }

    @Test
    fun `signed access without expiry or already expired is rejected`() {
        val now = Instant.now()
        val subject = UUID.randomUUID().toString()
        val claims = listOf(
            JwtClaimsSet.builder().subject(subject).issuedAt(now).build(),
            JwtClaimsSet.builder().subject(subject).issuedAt(now.minusSeconds(120)).expiresAt(now.minusSeconds(60)).build(),
        )
        for (claim in claims) {
            val token = jwt.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claim)).tokenValue
            mvc.perform(get("/api/v1/auth/sessions").header("Authorization", "Bearer $token"))
                .andExpect(status().is4xxClientError())
        }
    }

    @Test
    fun `sessions requires a valid signed bearer token`() {
        mvc.perform(get("/api/v1/auth/sessions")).andExpect(status().is4xxClientError())
        val response = login(member()).response
        val token = response.contentAsString.substringAfter("\"accessToken\":\"").substringBefore('"')
        mvc.perform(get("/api/v1/auth/sessions").header("Authorization", "Bearer $token"))
            .andExpect(status().isOk())
        mvc.perform(get("/api/v1/auth/sessions").header("Authorization", "Bearer ${token}invalid"))
            .andExpect(status().is4xxClientError())
    }
    @Test
    fun `old token from revoked or expired session does not revoke another device`() {
        for (expired in listOf(false, true)) {
            val email = member()
            val old = refreshCookie(login(email))
            val current = refreshCookie(refresh(old))
            if (expired) jdbc.update("update auth_session set expires_at = now() - interval '1 second' where member_id = (select id from auth_member where email = ?)", email)
            else mvc.perform(secured("/api/v1/auth/logout").cookie(current)).andExpect(status().isNoContent())
            val other = refreshCookie(login(email))
            assertTrue(refresh(old).response.status in 400..499)
            assertEquals(200, refresh(other).response.status)
        }
    }

    @Test
    fun `repeated logout clears cookie and remains csrf protected`() {
        val cookie = refreshCookie(login(member()))
        mvc.perform(secured("/api/v1/auth/logout").cookie(cookie)).andExpect(status().isNoContent())
        val result = mvc.perform(secured("/api/v1/auth/logout").cookie(cookie)).andExpect(status().isNoContent()).andReturn()
        assertTrue(result.response.getHeaders("Set-Cookie").any { it.startsWith("refresh_token=") && it.contains("Max-Age=0") })
        mvc.perform(post("/api/v1/auth/logout").cookie(cookie)).andExpect(status().isForbidden())
    }

}
