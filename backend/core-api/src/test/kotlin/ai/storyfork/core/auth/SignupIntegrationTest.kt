package ai.storyfork.core.auth

import ai.storyfork.core.auth.service.SignupService
import java.util.concurrent.Executors
import java.util.concurrent.CountDownLatch
import java.security.MessageDigest
import java.util.HexFormat
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.BeforeEach
import org.mockito.Mockito.doThrow
import org.springframework.mail.MailSendException
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.mockito.ArgumentCaptor
import org.mockito.Mockito.verify
import org.mockito.Mockito.times
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.mail.SimpleMailMessage
import org.springframework.mail.javamail.JavaMailSender
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

@SpringBootTest
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named = "AUTH_INTEGRATION_TEST", matches = "true")
class SignupIntegrationTest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var signup: SignupService
    @MockitoBean lateinit var mail: JavaMailSender

    private fun securedPost(path: String): MockHttpServletRequestBuilder {
        val response = mvc.perform(get("/api/v1/auth/csrf")).andReturn().response
        val token = response.contentAsString.substringAfter("\"csrfToken\":\"").substringBefore('"')
        return post(path).cookie(requireNotNull(response.getCookie("XSRF-TOKEN"))).header("X-CSRF-TOKEN", token)
    }

    @BeforeEach
    fun clearDatabase() {
        jdbc.update("delete from auth_signup_challenge")
        jdbc.update("delete from auth_refresh_token")
        jdbc.update("delete from auth_session")
        jdbc.update("delete from auth_member")
    }

    @Test
    fun `csrf endpoint supplies token and missing token is rejected`() {
        val response = mvc.perform(get("/api/v1/auth/csrf"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.csrfToken").isNotEmpty()).andReturn().response
        val token = response.contentAsString.substringAfter("\"csrfToken\":\"").substringBefore('"')
        val cookie = requireNotNull(response.getCookie("XSRF-TOKEN"))
        mvc.perform(post("/api/v1/auth/signup").contentType(MediaType.APPLICATION_JSON)
            .content("""{"email":"signup-test@example.invalid","password":"a-long-test-password","nickname":"Reader"}"""))
            .andExpect(status().isForbidden())
        mvc.perform(post("/api/v1/auth/signup").cookie(cookie).header("X-CSRF-TOKEN", token).contentType(MediaType.APPLICATION_JSON)
            .content("""{"email":"invalid","password":"a-long-test-password","nickname":"Reader"}"""))
            .andExpect(status().isBadRequest())
    }

    @Test
    fun `concurrent signup and token consumption create only one member`() {
        val pool = Executors.newFixedThreadPool(2)
        try {
            val start = CountDownLatch(1)
            val requests = (1..2).map { pool.submit<Boolean> {
                start.await()
                runCatching { signup.signup("race@example.invalid", "a-long-test-password", "Reader") }.isSuccess
            } }
            start.countDown()
            assertEquals(2, requests.count { it.get() })
            val messages = ArgumentCaptor.forClass(SimpleMailMessage::class.java)
            verify(mail, times(2)).send(messages.capture())
            val token = messages.allValues.map { requireNotNull(it.text).substringAfter("#token=").trim() }.single {
                jdbc.queryForObject("select count(*) from auth_signup_challenge where token_hash = ?", Int::class.java, digest(it)) == 1
            }
            val verifyStart = CountDownLatch(1)
            val checks = (1..2).map { pool.submit<Boolean> {
                verifyStart.await()
                runCatching { signup.verify(token, "a-long-test-password") }.isSuccess
            } }
            verifyStart.countDown()
            assertEquals(1, checks.count { it.get() })
            assertEquals(1, jdbc.queryForObject("select count(*) from auth_member", Int::class.java))
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun `mail failure rolls back pending signup`() {
        doThrow(MailSendException("delivery failed")).`when`(mail).send(org.mockito.ArgumentMatchers.any(SimpleMailMessage::class.java))
        mvc.perform(securedPost("/api/v1/auth/signup").contentType(MediaType.APPLICATION_JSON)
            .content("""{"email":"signup-test@example.invalid","password":"a-long-test-password","nickname":"Reader"}"""))
            .andExpect(status().isServiceUnavailable())
        assertEquals(0, jdbc.queryForObject("select count(*) from auth_signup_challenge", Int::class.java))
    }

    @Test
    fun `resend replaces prior token and unknown address gets accepted`() {
        mvc.perform(securedPost("/api/v1/auth/signup").contentType(MediaType.APPLICATION_JSON)
            .content("""{"email":"signup-test@example.invalid","password":"a-long-test-password","nickname":"Reader"}"""))
            .andExpect(status().isAccepted())
        for (email in listOf("signup-test@example.invalid", "unknown@example.invalid")) {
            mvc.perform(securedPost("/api/v1/auth/resend-verification").contentType(MediaType.APPLICATION_JSON)
                .content("""{"email":"$email"}""")).andExpect(status().isAccepted())
        }
        val messages = ArgumentCaptor.forClass(SimpleMailMessage::class.java)
        verify(mail, times(2)).send(messages.capture())
        val tokens = messages.allValues.map { requireNotNull(it.text).substringAfter("#token=").trim() }
        mvc.perform(securedPost("/api/v1/auth/verify-email").contentType(MediaType.APPLICATION_JSON)
            .content("""{"token":"${tokens[0]}","password":"a-long-test-password"}""")).andExpect(status().is4xxClientError())
        mvc.perform(securedPost("/api/v1/auth/verify-email").contentType(MediaType.APPLICATION_JSON)
            .content("""{"token":"${tokens[1]}","password":"a-long-test-password"}""")).andExpect(status().isNoContent())
    }

    @Test
    fun `expired verification token is rejected`() {
        mvc.perform(securedPost("/api/v1/auth/signup").contentType(MediaType.APPLICATION_JSON)
            .content("""{"email":"signup-test@example.invalid","password":"a-long-test-password","nickname":"Reader"}"""))
            .andExpect(status().isAccepted())
        val message = ArgumentCaptor.forClass(SimpleMailMessage::class.java)
        verify(mail).send(message.capture())
        val token = requireNotNull(message.value.text).substringAfter("#token=").trim()
        jdbc.update("update auth_signup_challenge set expires_at = now() - interval '1 second'")
        mvc.perform(securedPost("/api/v1/auth/verify-email").contentType(MediaType.APPLICATION_JSON)
            .content("""{"token":"$token","password":"a-long-test-password"}""")).andExpect(status().is4xxClientError())
        assertEquals(0, jdbc.queryForObject("select count(*) from auth_member", Int::class.java))
    }

    @Test
    fun `signup creates a member only after a token is consumed once`() {
        mvc.perform(securedPost("/api/v1/auth/signup").contentType(MediaType.APPLICATION_JSON)
            .content("""{"email":"signup-test@example.invalid","password":"a-long-test-password","nickname":"Reader"}"""))
            .andExpect(status().isAccepted())
        assertEquals(0, jdbc.queryForObject("select count(*) from auth_member", Int::class.java))
        val message = ArgumentCaptor.forClass(SimpleMailMessage::class.java)
        verify(mail).send(message.capture())
        val token = requireNotNull(message.value.text).substringAfter("#token=").trim()
        mvc.perform(securedPost("/api/v1/auth/verify-email").contentType(MediaType.APPLICATION_JSON)
            .content("""{"token":"$token","password":"a-long-test-password"}""")).andExpect(status().isNoContent())
        assertEquals(1, jdbc.queryForObject("select count(*) from auth_member", Int::class.java))
        mvc.perform(securedPost("/api/v1/auth/verify-email").contentType(MediaType.APPLICATION_JSON)
            .content("""{"token":"$token","password":"a-long-test-password"}""")).andExpect(status().is4xxClientError())
        mvc.perform(securedPost("/api/v1/auth/signup").contentType(MediaType.APPLICATION_JSON)
            .content("""{"email":"signup-test@example.invalid","password":"a-long-test-password","nickname":"Reader"}"""))
            .andExpect(status().is4xxClientError())
    }
    @Test
    fun `resend failure is generic and preserves previous verification link`() {
        signup.signup("resend@example.invalid", "test-password", "Reader")
        val message = ArgumentCaptor.forClass(SimpleMailMessage::class.java)
        verify(mail).send(message.capture())
        val token = requireNotNull(message.value.text).substringAfter("#token=").trim()
        doThrow(MailSendException("delivery failed")).`when`(mail).send(org.mockito.ArgumentMatchers.any(SimpleMailMessage::class.java))
        for (email in listOf("resend@example.invalid", "unknown@example.invalid")) {
            mvc.perform(securedPost("/api/v1/auth/resend-verification").contentType(MediaType.APPLICATION_JSON)
                .content("""{"email":"$email"}""")).andExpect(status().isAccepted())
        }
        signup.verify(token, "test-password")
        assertEquals(1, jdbc.queryForObject("select count(*) from auth_member", Int::class.java))
    }

    @Test
    fun `blank password is rejected and expired signup can be recovered by resend`() {
        mvc.perform(securedPost("/api/v1/auth/signup").contentType(MediaType.APPLICATION_JSON)
            .content("""{"email":"blank@example.invalid","password":"        ","nickname":"Reader"}"""))
            .andExpect(status().isBadRequest())
        signup.signup("expired@example.invalid", "test-password", "Reader")
        jdbc.update("update auth_signup_challenge set expires_at = now() - interval '1 second'")
        signup.resend("expired@example.invalid")
        val messages = ArgumentCaptor.forClass(SimpleMailMessage::class.java)
        verify(mail, times(2)).send(messages.capture())
        signup.verify(requireNotNull(messages.allValues.last().text).substringAfter("#token=").trim(), "test-password")
        assertEquals(1, jdbc.queryForObject("select count(*) from auth_member", Int::class.java))
    }

    private fun digest(token: String) = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.toByteArray()))

    private fun verifyToken(token: String, password: String) =
        mvc.perform(securedPost("/api/v1/auth/verify-email").contentType(MediaType.APPLICATION_JSON)
            .content("""{"token":"$token","password":"$password"}"""))

    @Test
    fun `pending and expired candidates are replaced with the latest signup and old links fail`() {
        signup.signup("replace@example.invalid", "first-password", "First")
        val messages = ArgumentCaptor.forClass(SimpleMailMessage::class.java)
        verify(mail).send(messages.capture())
        val firstToken = requireNotNull(messages.value.text).substringAfter("#token=").trim()
        for (expired in listOf(false, true)) {
            if (expired) jdbc.update("update auth_signup_challenge set expires_at = now() - interval '1 second'")
            mvc.perform(securedPost("/api/v1/auth/signup").contentType(MediaType.APPLICATION_JSON)
                .content("""{"email":"replace@example.invalid","password":"latest-password","nickname":"Latest"}"""))
                .andExpect(status().isAccepted())
            val candidate = jdbc.queryForMap("select * from auth_signup_challenge")
            assertTrue(BCryptPasswordEncoder().matches("latest-password", candidate["password_hash"].toString()))
            assertFalse(BCryptPasswordEncoder().matches("first-password", candidate["password_hash"].toString()))
            assertEquals("Latest", candidate["nickname"])
            assertEquals(1, jdbc.queryForObject("select count(*) from auth_signup_challenge where expires_at > now() + interval '23 hours'", Int::class.java))
        }
        verify(mail, times(3)).send(messages.capture())
        val latestToken = requireNotNull(messages.allValues.last().text).substringAfter("#token=").trim()
        verifyToken(firstToken, "first-password").andExpect(status().isBadRequest())
        verifyToken(latestToken, "latest-password").andExpect(status().isNoContent())
        assertEquals("Latest", jdbc.queryForObject("select nickname from auth_member", String::class.java))
        mvc.perform(securedPost("/api/v1/auth/signup").contentType(MediaType.APPLICATION_JSON)
            .content("""{"email":"replace@example.invalid","password":"latest-password","nickname":"Latest"}"""))
            .andExpect(status().isConflict())
    }

    @Test
    fun `verification requires the signup password and rejected proofs do not consume the token`() {
        val password = "한".repeat(24)
        signup.signup("proof@example.invalid", password, "Reader")
        val message = ArgumentCaptor.forClass(SimpleMailMessage::class.java)
        verify(mail).send(message.capture())
        val token = requireNotNull(message.value.text).substringAfter("#token=").trim()
        mvc.perform(securedPost("/api/v1/auth/verify-email").contentType(MediaType.APPLICATION_JSON)
            .content("""{"token":"$token"}""")).andExpect(status().isBadRequest())
        for (invalid in listOf("wrong-password", "        ", "short", "한".repeat(25))) {
            verifyToken(token, invalid).andExpect(status().isBadRequest())
            assertEquals(0, jdbc.queryForObject("select count(*) from auth_member", Int::class.java))
            assertEquals(1, jdbc.queryForObject("select count(*) from auth_signup_challenge where token_hash = ?", Int::class.java, digest(token)))
        }
        verifyToken(token, password).andExpect(status().isNoContent())
        verifyToken(token, password).andExpect(status().isBadRequest())
    }

    @Test
    fun `email owner cannot confirm an attacker password and can replace it with their own signup`() {
        signup.signup("owner@example.invalid", "attacker-password", "Attacker")
        val messages = ArgumentCaptor.forClass(SimpleMailMessage::class.java)
        verify(mail).send(messages.capture())
        val attackerToken = requireNotNull(messages.value.text).substringAfter("#token=").trim()
        verifyToken(attackerToken, "owner-password").andExpect(status().isBadRequest())
        assertEquals(0, jdbc.queryForObject("select count(*) from auth_member", Int::class.java))
        signup.signup("owner@example.invalid", "owner-password", "Owner")
        verify(mail, times(2)).send(messages.capture())
        val ownerToken = requireNotNull(messages.allValues.last().text).substringAfter("#token=").trim()
        verifyToken(attackerToken, "attacker-password").andExpect(status().isBadRequest())
        verifyToken(ownerToken, "owner-password").andExpect(status().isNoContent())
        for ((password, expected) in listOf("attacker-password" to 401, "owner-password" to 200)) {
            mvc.perform(securedPost("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("""{"email":"owner@example.invalid","password":"$password"}"""))
                .andExpect(status().`is`(expected))
        }
    }

    @Test
    fun `mail failure when replacing a candidate restores the previous password nickname and token`() {
        signup.signup("rollback@example.invalid", "first-password", "First")
        val message = ArgumentCaptor.forClass(SimpleMailMessage::class.java)
        verify(mail).send(message.capture())
        val token = requireNotNull(message.value.text).substringAfter("#token=").trim()
        val before = jdbc.queryForMap("select * from auth_signup_challenge")
        doThrow(MailSendException("delivery failed")).`when`(mail).send(org.mockito.ArgumentMatchers.any(SimpleMailMessage::class.java))
        mvc.perform(securedPost("/api/v1/auth/signup").contentType(MediaType.APPLICATION_JSON)
            .content("""{"email":"rollback@example.invalid","password":"new-password","nickname":"New"}"""))
            .andExpect(status().isServiceUnavailable())
        assertEquals(before, jdbc.queryForMap("select * from auth_signup_challenge"))
        verifyToken(token, "first-password").andExpect(status().isNoContent())
    }
}
