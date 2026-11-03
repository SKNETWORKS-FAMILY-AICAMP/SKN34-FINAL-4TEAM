package ai.storyfork.core.auth.service

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.junit.jupiter.api.Assertions.assertThrows
import org.mockito.Mockito.mock
import ai.storyfork.core.auth.repository.SignupRepository
import org.springframework.mail.javamail.JavaMailSender

class SignupServiceTest {
    @Test
    fun `invalid public origin fails closed`() {
        for (origin in listOf("", "https://example.com/path", "https://example.com?token=x", "http://remote.example")) {
            assertThrows(IllegalArgumentException::class.java) {
                SignupService(mock(SignupRepository::class.java), mock(JavaMailSender::class.java), origin, "dev@example.invalid")
            }
        }
    }

    @Test
    fun `password is hashed and token has sufficient entropy`() {
        val secrets = SignupSecrets()
        val encoded = secrets.hashPassword("correct horse battery staple")
        assertFalse(encoded.contains("correct horse battery staple"))
        assertTrue(BCryptPasswordEncoder().matches("correct horse battery staple", encoded))
        assertFalse(BCryptPasswordEncoder().matches("wrong password", encoded))
        assertTrue(secrets.newToken().length >= 32)
    }
}
