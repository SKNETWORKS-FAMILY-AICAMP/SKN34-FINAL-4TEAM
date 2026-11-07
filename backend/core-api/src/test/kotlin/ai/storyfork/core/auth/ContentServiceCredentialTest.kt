package ai.storyfork.core.auth

import ai.storyfork.core.auth.service.AuthException
import ai.storyfork.core.auth.service.AuthVerificationService
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ContentServiceCredentialTest {
    @Test fun `empty configuration missing header wrong service token and user bearer never authenticate a service`() {
        val token = "test-only-service-credential-32-bytes"
        assertFalse(AuthVerificationService("").isTrusted(token))
        assertFalse(AuthVerificationService("short").isTrusted("short"))
        val service = AuthVerificationService(token)
        for (input in listOf(null, "", "wrong", "Bearer $token")) assertFalse(service.isTrusted(input))
        assertTrue(service.isTrusted(token))
    }

    @Test fun `only a canonical UUID subject becomes the minimal response`() {
        val service = AuthVerificationService("")
        val id = UUID.randomUUID()
        assertEquals(id, service.verify(id.toString()).memberId)
        for (value in listOf(null, "forged-owner", "1-1-1-1-1", "")) {
            assertEquals(AuthException.Reason.UNAUTHENTICATED, assertThrows(AuthException::class.java) { service.verify(value) }.reason)
        }
    }
}
