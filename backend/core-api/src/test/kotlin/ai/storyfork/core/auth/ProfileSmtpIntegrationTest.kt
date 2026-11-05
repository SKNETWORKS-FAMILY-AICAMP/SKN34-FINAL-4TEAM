package ai.storyfork.core.auth

import ai.storyfork.core.auth.service.ProfileService
import ai.storyfork.core.auth.service.dto.EmailRequest
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder

@SpringBootTest
@EnabledIfEnvironmentVariable(named = "AUTH_MAILPIT_API", matches = ".+")
class ProfileSmtpIntegrationTest {
    @Autowired lateinit var profiles: ProfileService
    @Autowired lateinit var jdbc: JdbcTemplate

    @Test
    fun `recovery and change send through smtp`() {
        val id = UUID.randomUUID()
        val email = "$id@example.invalid"
        val target = "${UUID.randomUUID()}@example.invalid"
        jdbc.update("insert into auth_member(id,email,password_hash,nickname) values (?,?,?,?)", id, email, BCryptPasswordEncoder().encode("test-password"), "Reader")
        profiles.forgotPassword(EmailRequest(email))
        profiles.requestEmailChange(id, EmailRequest(target))
        val uri = URI.create(System.getenv("AUTH_MAILPIT_API") + "/api/v1/messages")
        val response = HttpClient.newHttpClient().send(HttpRequest.newBuilder(uri).GET().build(), HttpResponse.BodyHandlers.ofString())
        assertTrue(response.statusCode() == 200 && response.body().contains(email) && response.body().contains(target))
    }
}
