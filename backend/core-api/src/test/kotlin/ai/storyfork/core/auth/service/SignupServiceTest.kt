package ai.storyfork.core.auth.service

import ai.storyfork.core.auth.config.AuthSecurityConfig
import ai.storyfork.core.auth.helper.AuthTokenHelper
import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.repository.SignupChallengeRepository
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.springframework.mail.javamail.JavaMailSender
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.transaction.support.TransactionTemplate

class SignupServiceTest {
    @Test
    fun `invalid public origin fails closed`() {
        for (origin in listOf("", "https://example.com/path", "https://example.com?token=x", "http://remote.example")) {
            assertThrows(IllegalArgumentException::class.java) {
                SignupService(mock(MemberRepository::class.java), mock(SignupChallengeRepository::class.java),
                    AuthSecurityConfig().passwordEncoder(), AuthTokenHelper(), mock(TransactionTemplate::class.java),
                    mock(JavaMailSender::class.java), origin, "dev@example.invalid")
            }
        }
    }

    @Test
    fun `password is hashed and token has sufficient entropy`() {
        val passwords = AuthSecurityConfig().passwordEncoder()
        val encoded = requireNotNull(passwords.encode("correct horse battery staple"))
        assertFalse(encoded.contains("correct horse battery staple"))
        assertTrue(BCryptPasswordEncoder().matches("correct horse battery staple", encoded))
        assertFalse(BCryptPasswordEncoder().matches("wrong password", encoded))
        assertTrue(passwords.matches("correct horse battery staple", encoded))
        assertFalse(passwords.matches("wrong password", encoded))
        assertTrue(AuthTokenHelper().newToken().length >= 32)
    }
}
