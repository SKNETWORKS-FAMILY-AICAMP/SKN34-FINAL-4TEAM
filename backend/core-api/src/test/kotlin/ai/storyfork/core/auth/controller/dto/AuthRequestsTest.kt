package ai.storyfork.core.auth.controller.dto

import jakarta.validation.Validation
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AuthRequestsTest {
    @Test
    fun `moved public requests keep their validation contract`() {
        Validation.buildDefaultValidatorFactory().use { factory ->
            val validator = factory.validator
            assertTrue(validator.validate(SignupRequest("reader@example.com", "password1", "Reader")).isEmpty())
            assertEquals(setOf("email", "password", "nickname"),
                validator.validate(SignupRequest("bad-email", "short", "")).map { it.propertyPath.toString() }.toSet())
            assertEquals(setOf("email"), validator.validate(EmailRequest("bad-email")).map { it.propertyPath.toString() }.toSet())
            assertEquals(setOf("token"), validator.validate(TokenRequest("")).map { it.propertyPath.toString() }.toSet())
            assertEquals(setOf("token", "password"),
                validator.validate(VerificationRequest("", "short")).map { it.propertyPath.toString() }.toSet())
        }
    }
}
