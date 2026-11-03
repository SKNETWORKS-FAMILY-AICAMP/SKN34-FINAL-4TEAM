package ai.storyfork.core.auth

import ai.storyfork.core.auth.repository.SignupRepository
import java.net.CookieManager
import java.net.CookiePolicy
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.util.HexFormat
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = [
        "app.ai-service.base-url=http://127.0.0.1:1",
        "app.ai-service.connect-timeout=10ms",
        "app.ai-service.read-timeout=10ms",
        "logging.level.org.springframework.security.web.FilterChainProxy=DEBUG",
    ],
)
@EnabledIfEnvironmentVariable(named = "AUTH_INTEGRATION_TEST", matches = "true")
class AuthHttpErrorIntegrationTest {
    @LocalServerPort var port: Int = 0
    @Autowired lateinit var signup: SignupRepository
    @Autowired lateinit var json: ObjectMapper

    private val client = HttpClient.newBuilder()
        .cookieHandler(CookieManager(null, CookiePolicy.ACCEPT_ALL))
        .connectTimeout(Duration.ofSeconds(5)).build()

    private fun request(path: String): HttpRequest.Builder =
        HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path"))
            .timeout(Duration.ofSeconds(10)).header("Accept", "application/json")

    private fun send(request: HttpRequest.Builder): HttpResponse<String> =
        client.send(request.build(), HttpResponse.BodyHandlers.ofString())

    private fun mutation(path: String, body: String = "{}", method: String = "POST"): HttpRequest.Builder {
        val csrf = send(request("/api/v1/auth/csrf"))
        assertEquals(200, csrf.statusCode())
        return request(path).header("X-CSRF-TOKEN", json.readTree(csrf.body()).path("csrfToken").asText())
            .header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofString(body))
    }

    private fun login(): JsonNode {
        val email = "${UUID.randomUUID()}@example.invalid"
        signup.createMember(email, requireNotNull(BCryptPasswordEncoder().encode("test-password")), "Reader")
        val response = send(mutation("/api/v1/auth/login", """{"email":"$email","password":"test-password"}"""))
        assertEquals(200, response.statusCode())
        return json.readTree(response.body())
    }

    @Test
    fun `reused verification token stays 400 over embedded servlet error dispatch`() {
        val token = UUID.randomUUID().toString()
        val hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.toByteArray()))
        signup.createChallenge("${UUID.randomUUID()}@example.invalid", "unused-password-hash", "Reader", hash, Instant.now().plusSeconds(60))
        val body = """{"token":"$token"}"""
        assertEquals(204, send(mutation("/api/v1/auth/verify-email", body)).statusCode())
        val reused = send(mutation("/api/v1/auth/verify-email", body))
        assertEquals(400, reused.statusCode())
        assertEquals(400, json.readTree(reused.body()).path("status").asInt())
        for (internal in listOf("trace", "exception", "message")) assertFalse(json.readTree(reused.body()).has(internal))
        assertFalse(reused.body().contains(token))
        assertFalse(reused.body().contains(hash))
    }

    @Test
    fun `logout owner conflict stays 409 without clearing or consuming the current account cookie`() {
        val stale = login().path("user").path("id").asText()
        val current = login().path("user").path("id").asText()
        val conflict = send(mutation("/api/v1/auth/logout").header("X-Auth-User", stale))
        assertEquals(409, conflict.statusCode())
        assertEquals(409, json.readTree(conflict.body()).path("status").asInt())
        assertTrue(conflict.headers().allValues("Set-Cookie").none { it.startsWith("refresh_token=") })
        val rejected = send(mutation("/api/v1/auth/refresh").header("X-Auth-User", stale))
        assertEquals(401, rejected.statusCode())
        assertTrue(rejected.headers().allValues("Set-Cookie").none { it.startsWith("refresh_token=") })
        val refreshed = send(mutation("/api/v1/auth/refresh").header("X-Auth-User", current))
        assertEquals(200, refreshed.statusCode())
        assertEquals(current, json.readTree(refreshed.body()).path("user").path("id").asText())
    }

    @Test
    fun `anonymous protected requests remain 401 and mutations without csrf remain 403`() {
        for (path in listOf("/api/v1/me", "/api/v1/auth/sessions")) {
            assertEquals(401, send(request(path)).statusCode())
            assertEquals(401, send(request(path).header("Authorization", "Bearer invalid")).statusCode())
        }
        for (path in listOf("/api/v1/auth/verify-email", "/api/v1/auth/logout", "/api/v1/auth/logout-all")) {
            assertEquals(403, send(request(path).POST(HttpRequest.BodyPublishers.ofString("{}"))).statusCode())
        }
    }

    @Test
    fun `bearer session ownership and csrf survive error dispatch without an html fallback`() {
        val other = login().path("accessToken").asText()
        val owner = login().path("accessToken").asText()
        val sessions = send(request("/api/v1/auth/sessions").header("Authorization", "Bearer $owner"))
        assertEquals(200, sessions.statusCode())
        val id = json.readTree(sessions.body()).path("sessions").path(0).path("id").asText()
        assertTrue(id.isNotBlank())
        val path = "/api/v1/auth/sessions/$id"
        val forbidden = send(mutation(path, method = "DELETE").header("Authorization", "Bearer $other"))
        assertEquals(404, forbidden.statusCode())
        assertTrue(forbidden.headers().firstValue("Content-Type").orElse("").startsWith("application/json"))
        assertEquals(404, json.readTree(forbidden.body()).path("status").asInt())
        assertEquals(403, send(request(path).header("Authorization", "Bearer $owner").DELETE()).statusCode())
        assertEquals(204, send(mutation(path, method = "DELETE").header("Authorization", "Bearer $owner")).statusCode())
    }

    @Test
    fun `error path is not public for ordinary client requests`() {
        assertEquals(401, send(request("/error")).statusCode())
        val token = login().path("accessToken").asText()
        assertEquals(403, send(request("/error").header("Authorization", "Bearer $token")).statusCode())
    }

    @Test
    fun `public health and ai failure contracts remain unchanged`() {
        val health = send(request("/api/v1/health"))
        assertEquals(200, health.statusCode())
        assertEquals("up", json.readTree(health.body()).path("status").asText())
        assertEquals("storyfork-core-api", json.readTree(health.body()).path("service").asText())
        val ai = send(request("/api/v1/health/ai-service"))
        assertEquals(503, ai.statusCode())
        assertTrue(ai.headers().firstValue("Content-Type").orElse("").startsWith("application/problem+json"))
        assertEquals("AI_SERVICE_UNAVAILABLE", json.readTree(ai.body()).path("code").asText())
        assertFalse(ai.body().contains("127.0.0.1"))
    }
}
