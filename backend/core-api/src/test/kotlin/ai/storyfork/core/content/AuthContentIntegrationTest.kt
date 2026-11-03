package ai.storyfork.core.content

import ai.storyfork.core.auth.repository.SignupRepository
import java.net.CookieManager
import java.net.CookiePolicy
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = [
        "app.content.enabled=true",
        "app.content.dev-owner=must-not-authorize",
        "CONTENT_DATABASE_URL=\${CORE_DATABASE_URL}",
        "CONTENT_DATABASE_USER=\${CORE_DATABASE_USER}",
        "CONTENT_DATABASE_PASSWORD=\${CORE_DATABASE_PASSWORD}",
    ],
)
@EnabledIfEnvironmentVariable(named = "AUTH_INTEGRATION_TEST", matches = "true")
class AuthContentIntegrationTest {
    @LocalServerPort var port: Int = 0
    @Autowired lateinit var signup: SignupRepository
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var json: ObjectMapper
    private val client = HttpClient.newBuilder().cookieHandler(CookieManager(null, CookiePolicy.ACCEPT_ALL)).build()

    private fun request(path: String) = HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path"))
        .header("Accept", "application/json")
    private fun send(request: HttpRequest.Builder): HttpResponse<String> =
        client.send(request.build(), HttpResponse.BodyHandlers.ofString())
    private fun mutation(path: String, body: String, method: String = "POST"): HttpRequest.Builder {
        val csrf = send(request("/api/v1/auth/csrf"))
        assertEquals(200, csrf.statusCode())
        return request(path).header("X-CSRF-TOKEN", json.readTree(csrf.body()).path("csrfToken").asText())
            .header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofString(body))
    }
    private fun login(): JsonNode {
        val email = "${UUID.randomUUID()}@example.invalid"
        signup.createMember(email, requireNotNull(BCryptPasswordEncoder().encode("test-password")), "Writer")
        val response = send(mutation("/api/v1/auth/login", """{"email":"$email","password":"test-password"}"""))
        assertEquals(200, response.statusCode())
        return json.readTree(response.body())
    }

    @Test
    fun `real login JWT owns private content and another member receives 404`() {
        val user = login()
        val token = user.path("accessToken").asText()
        val created = send(mutation("/api/v1/works", """{"title":"JWT ownership"}""")
            .header("Authorization", "Bearer $token").header("X-User-Id", "forged-owner"))
        assertEquals(201, created.statusCode())
        val id = json.readTree(created.body()).path("id").asText()
        assertEquals(user.path("user").path("id").asText(), jdbc.queryForObject("SELECT owner_id FROM work WHERE id=?", String::class.java, id))
        assertEquals(200, send(request("/api/v1/works/$id").header("Authorization", "Bearer $token")).statusCode())
        val other = login().path("accessToken").asText()
        assertEquals(404, send(request("/api/v1/works/$id").header("Authorization", "Bearer $other")).statusCode())
        assertEquals(404, send(request("/api/v1/public/works/$id")).statusCode())
        assertTrue(jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history WHERE success", Int::class.java)!! >= 3)
        assertEquals(7, jdbc.queryForObject("SELECT count(*) FROM content_schema_history WHERE success AND type <> 'BASELINE'", Int::class.java))
    }

    @Test
    fun `only public GET is anonymous and private writes require csrf and allowed origin`() {
        assertEquals(200, send(request("/api/v1/public/works")).statusCode())
        assertEquals(401, send(request("/api/v1/works").header("X-User-Id", "forged-owner")).statusCode())
        assertEquals(401, send(mutation("/api/v1/works", """{"title":"anonymous"}""")).statusCode())
        assertEquals(401, send(mutation("/api/v1/public/works", "{}")).statusCode())
        val token = login().path("accessToken").asText()
        assertEquals(403, send(request("/api/v1/works").header("Authorization", "Bearer $token")
            .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString("""{"title":"no csrf"}"""))).statusCode())
        assertEquals(403, send(mutation("/api/v1/works", """{"title":"foreign origin"}""")
            .header("Authorization", "Bearer $token").header("Origin", "https://evil.example")).statusCode())
        assertEquals(403, send(mutation("/api/v1/public/works", "{}").header("Authorization", "Bearer $token")).statusCode())
        assertEquals(403, send(request("/api/v1/not-implemented").header("Authorization", "Bearer $token")).statusCode())
        assertEquals(403, send(request("/error").header("Authorization", "Bearer $token")).statusCode())
        val invalid = send(mutation("/api/v1/works", """{"title":""}""").header("Authorization", "Bearer $token"))
        assertEquals(422, invalid.statusCode())
        assertFalse(invalid.body().contains("rejected value"))
    }
}
