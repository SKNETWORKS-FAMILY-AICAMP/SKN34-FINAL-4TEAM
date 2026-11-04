package ai.storyfork.core.auth

import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.junit.jupiter.api.extension.ExtendWith
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.boot.test.system.OutputCaptureExtension
import org.mockito.ArgumentCaptor
import org.mockito.Mockito.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.mail.SimpleMailMessage
import org.springframework.mail.javamail.JavaMailSender
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.*

@SpringBootTest
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named = "AUTH_INTEGRATION_TEST", matches = "true")
class ProfileIntegrationTest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var jdbc: JdbcTemplate
    @MockitoBean lateinit var mail: JavaMailSender

    private fun member(): String {
        val email = "${UUID.randomUUID()}@example.invalid"
        jdbc.update("insert into auth_member(id,email,password_hash,nickname) values (?,?,?,?)", UUID.randomUUID(), email, BCryptPasswordEncoder().encode("test-password"), "Reader")
        return email
    }
    private fun csrf(request: MockHttpServletRequestBuilder): MockHttpServletRequestBuilder {
        val response = mvc.perform(get("/api/v1/auth/csrf")).andReturn().response
        return request.cookie(requireNotNull(response.getCookie("XSRF-TOKEN"))).header("X-CSRF-TOKEN", response.contentAsString.substringAfter("\"csrfToken\":\"").substringBefore('"'))
    }
    private fun login(email: String, password: String = "test-password") = mvc.perform(csrf(post("/api/v1/auth/login"))
        .contentType(MediaType.APPLICATION_JSON).content("""{"email":"$email","password":"$password"}""")).andReturn().response
    private fun bearer(email: String): String = "Bearer " + login(email).contentAsString.substringAfter("\"accessToken\":\"").substringBefore('"')
    private fun json(request: MockHttpServletRequestBuilder, body: String) = csrf(request).contentType(MediaType.APPLICATION_JSON).content(body)
    private fun sentToken(): String {
        val message = ArgumentCaptor.forClass(SimpleMailMessage::class.java)
        verify(mail).send(message.capture())
        return requireNotNull(message.value.text).substringAfter("#token=").trim()
    }

    @Test
    fun `authenticated member can read and update their own profile`() {
        val email = member()
        val authorization = bearer(email)
        mvc.perform(get("/api/v1/me")).andExpect(status().is4xxClientError())
        mvc.perform(get("/api/v1/me").header("Authorization", authorization)).andExpect(status().isOk()).andExpect(jsonPath("$.email").value(email))
        mvc.perform(json(patch("/api/v1/me").header("Authorization", authorization), """{"nickname":"New reader"}"""))
            .andExpect(status().isOk()).andExpect(jsonPath("$.nickname").value("New reader"))
        mvc.perform(patch("/api/v1/me").header("Authorization", authorization).contentType(MediaType.APPLICATION_JSON).content("""{"nickname":"Bad"}"""))
            .andExpect(status().isForbidden())
    }

    @Test
    fun `email change requires link and is single use`() {
        val email = member()
        val address = "${UUID.randomUUID()}@example.invalid"
        val authorization = bearer(email)
        mvc.perform(json(post("/api/v1/me/email-change").header("Authorization", authorization), """{"email":"$address"}""")).andExpect(status().isAccepted())
        val token = sentToken()
        mvc.perform(get("/api/v1/me").header("Authorization", authorization)).andExpect(jsonPath("$.email").value(email))
        val body = """{"token":"$token"}"""
        mvc.perform(json(post("/api/v1/auth/verify-email-change"), body)).andExpect(status().isNoContent())
        mvc.perform(get("/api/v1/me").header("Authorization", authorization)).andExpect(jsonPath("$.email").value(address))
        mvc.perform(json(post("/api/v1/auth/verify-email-change"), body)).andExpect(status().is4xxClientError())
    }

    @Test
    fun `expired and duplicate email challenges cannot change accounts`() {
        val email = member()
        val occupied = member()
        val authorization = bearer(email)
        mvc.perform(json(post("/api/v1/me/email-change").header("Authorization", authorization), """{"email":"$occupied"}""")).andExpect(status().isConflict())
        val target = "${UUID.randomUUID()}@example.invalid"
        mvc.perform(json(post("/api/v1/me/email-change").header("Authorization", authorization), """{"email":"$target"}""")).andExpect(status().isAccepted())
        val token = sentToken()
        jdbc.update("update auth_profile_challenge set expires_at = now() - interval '1 second' where target_email = ?", target)
        mvc.perform(json(post("/api/v1/auth/verify-email-change"), """{"token":"$token"}""")).andExpect(status().is4xxClientError())
        mvc.perform(get("/api/v1/me").header("Authorization", authorization)).andExpect(jsonPath("$.email").value(email))
    }

    @Test
    @ExtendWith(OutputCaptureExtension::class)
    fun `two members racing for an email cannot both claim it`(output: CapturedOutput) {
        val target = "${UUID.randomUUID()}@example.invalid"
        for (email in listOf(member(), member())) {
            mvc.perform(json(post("/api/v1/me/email-change").header("Authorization", bearer(email)), """{"email":"$target"}""")).andExpect(status().isAccepted())
        }
        val messages = ArgumentCaptor.forClass(SimpleMailMessage::class.java)
        verify(mail, times(2)).send(messages.capture())
        val tokens = messages.allValues.map { requireNotNull(it.text).substringAfter("#token=").trim() }
        val pool = Executors.newFixedThreadPool(2)
        try {
            val start = CountDownLatch(1)
            val jobs = tokens.map { token -> pool.submit<Int> {
                start.await()
                mvc.perform(json(post("/api/v1/auth/verify-email-change"), """{"token":"$token"}""")).andReturn().response.status
            } }
            start.countDown()
            val results = jobs.map { it.get() }
            assertEquals(1, results.count { it == 204 })
            assertEquals(1, results.count { it == 409 })
            assertEquals(1, jdbc.queryForObject("select count(*) from auth_member where email = ?", Int::class.java, target))
            assertTrue(output.all.contains("SQLState: 23505"), "The collision must retain its SQLState diagnostic")
            assertTrue(output.all.contains("duplicate key value violates unique constraint"))
            assertFalse(output.all.contains(target), "Constraint logs must not disclose the target email")
        } finally { pool.shutdownNow() }
    }

    @Test
    fun `reset link to old address becomes invalid when email changes`() {
        val email = member()
        val authorization = bearer(email)
        mvc.perform(json(post("/api/v1/auth/forgot-password"), """{"email":"$email"}""")).andExpect(status().isAccepted())
        val resetToken = sentToken()
        reset(mail)
        val target = "${UUID.randomUUID()}@example.invalid"
        mvc.perform(json(post("/api/v1/me/email-change").header("Authorization", authorization), """{"email":"$target"}""")).andExpect(status().isAccepted())
        val changeToken = sentToken()
        mvc.perform(json(post("/api/v1/auth/verify-email-change"), """{"token":"$changeToken"}""")).andExpect(status().isNoContent())
        mvc.perform(json(post("/api/v1/auth/reset-password"), """{"token":"$resetToken","newPassword":"new-password"}""")).andExpect(status().is4xxClientError())
    }

    @Test
    fun `reset expiry and smtp failure do not reveal whether a member exists`() {
        val email = member()
        mvc.perform(json(post("/api/v1/auth/forgot-password"), """{"email":"$email"}""")).andExpect(status().isAccepted())
        val token = sentToken()
        jdbc.update("update auth_profile_challenge set expires_at = now() - interval '1 second' where target_email = ?", email)
        mvc.perform(json(post("/api/v1/auth/reset-password"), """{"token":"$token","newPassword":"new-password"}""")).andExpect(status().is4xxClientError())
        reset(mail)
        doThrow(org.springframework.mail.MailSendException("failed")).`when`(mail).send(org.mockito.ArgumentMatchers.any(SimpleMailMessage::class.java))
        for (address in listOf(email, "${UUID.randomUUID()}@example.invalid")) {
            mvc.perform(json(post("/api/v1/auth/forgot-password"), """{"email":"$address"}""")).andExpect(status().isAccepted())
        }
        verify(mail, times(1)).send(org.mockito.ArgumentMatchers.any(SimpleMailMessage::class.java))
        assertEquals(1, jdbc.queryForObject("select count(*) from auth_profile_challenge where target_email = ? and expires_at < now()", Int::class.java, email))
    }

    @Test
    fun `password reset is single use and revokes refresh`() {
        val email = member()
        val old = login(email)
        val cookieHeader = old.getHeaders("Set-Cookie").first { it.startsWith("refresh_token=") }
        val refresh = jakarta.servlet.http.Cookie("refresh_token", cookieHeader.substringAfter('=').substringBefore(';'))
        mvc.perform(json(post("/api/v1/auth/forgot-password"), """{"email":"$email"}""")).andExpect(status().isAccepted())
        val token = sentToken()
        val body = """{"token":"$token","newPassword":"new-password"}"""
        mvc.perform(json(post("/api/v1/auth/reset-password"), body)).andExpect(status().isNoContent())
        mvc.perform(json(post("/api/v1/auth/reset-password"), body)).andExpect(status().is4xxClientError())
        assertTrue(login(email).status in 400..499)
        assertEquals(200, login(email, "new-password").status)
        mvc.perform(csrf(post("/api/v1/auth/refresh")).cookie(refresh)).andExpect(status().is4xxClientError())
    }
    @Test
    fun `blank reset password is rejected without consuming the link`() {
        val email = member()
        mvc.perform(json(post("/api/v1/auth/forgot-password"), """{"email":"$email"}""")).andExpect(status().isAccepted())
        val token = sentToken()
        mvc.perform(json(post("/api/v1/auth/reset-password"), """{"token":"$token","newPassword":"        "}""")).andExpect(status().isBadRequest())
        mvc.perform(json(post("/api/v1/auth/reset-password"), """{"token":"$token","newPassword":"new-password"}""")).andExpect(status().isNoContent())
    }

}
