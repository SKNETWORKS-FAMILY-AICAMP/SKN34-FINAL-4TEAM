package ai.storyfork.core.auth.service

import java.security.SecureRandom
import java.util.Base64
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder

class SignupSecrets {
    private val passwords = BCryptPasswordEncoder()
    private val random = SecureRandom()

    fun hashPassword(password: String): String = requireNotNull(passwords.encode(password))
    fun matchesPassword(password: String, hash: String): Boolean = passwords.matches(password, hash)
    fun newToken(): String = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also(random::nextBytes))
}
