package ai.storyfork.core.auth

import ai.storyfork.core.auth.service.SignupService
import ai.storyfork.core.auth.service.dto.SignupRequest
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

@SpringBootTest
@EnabledIfEnvironmentVariable(named = "AUTH_MAILPIT_API", matches = ".+")
class SignupSmtpIntegrationTest {
    @Autowired lateinit var service: SignupService

    @Test
    fun `signup sends verification through smtp`() {
        val email = "${UUID.randomUUID()}@example.invalid"
        service.signup(SignupRequest(email, "a-long-test-password", "Reader"))
        val uri = URI.create(System.getenv("AUTH_MAILPIT_API") + "/api/v1/messages")
        val response = HttpClient.newHttpClient().send(HttpRequest.newBuilder(uri).GET().build(), HttpResponse.BodyHandlers.ofString())
        assertTrue(response.statusCode() == 200 && response.body().contains(email))
    }
}
