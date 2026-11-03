package ai.storyfork.core.auth

import ai.storyfork.core.auth.config.AuthSecurityConfig
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class AuthSecurityConfigTest {
    @Test
    fun `invalid and short signing keys fail closed`() {
        val config = AuthSecurityConfig()
        assertThrows(IllegalArgumentException::class.java) { config.signingKey("not base64!") }
        assertThrows(IllegalArgumentException::class.java) { config.signingKey("c2hvcnQ=") }
    }
}
