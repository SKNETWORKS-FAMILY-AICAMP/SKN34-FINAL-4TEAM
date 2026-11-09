package ai.storyfork.content.auth

import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
import ai.storyfork.content.auth.client.dto.NicknamesPayload
import ai.storyfork.content.auth.client.dto.NicknamesResponse
import ai.storyfork.content.auth.service.CoreAuthVerificationService
import ai.storyfork.content.auth.client.exception.CoreAuthException
import java.net.SocketTimeoutException
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.http.HttpHeaders
import org.springframework.web.client.*

class CoreAuthVerificationServiceTest {
    private fun client(call: (String) -> VerifiedMemberResponse) = object : CoreAuthClient {
        override fun verify(authorization: String) = call(authorization)
        override fun nicknames(request: NicknamesPayload): NicknamesResponse = throw UnsupportedOperationException("verify only")
    }

    @Test fun `forwards only the bearer and returns the verified UUID without caching`() {
        val id = UUID.randomUUID(); var calls = 0
        val service = CoreAuthVerificationService(client { header ->
            assertEquals("Bearer opaque-user-token", header); calls++; VerifiedMemberResponse(id)
        })
        repeat(2) { assertEquals(id, service.verify("Bearer opaque-user-token")) }
        assertEquals(2, calls)
    }

    @Test fun `empty upstream body fails as invalid response not invalid user`() {
        val service=CoreAuthVerificationService(org.mockito.Mockito.mock(CoreAuthClient::class.java))
        val error=assertThrows(CoreAuthException::class.java) { service.verify("Bearer opaque") }
        assertEquals(502,error.status)
        assertEquals("CORE_AUTH_INVALID_RESPONSE",error.code)
    }

    @Test fun `invalid user is 401 but service rejection upstream failure timeout and malformed response are distinct`() {
        val errors = listOf(
            HttpClientErrorException.create(org.springframework.http.HttpStatus.UNAUTHORIZED, "", HttpHeaders.EMPTY, byteArrayOf(), null) to (401 to "UNAUTHORIZED"),
            HttpClientErrorException.create(org.springframework.http.HttpStatus.FORBIDDEN, "", HttpHeaders.EMPTY, byteArrayOf(), null) to (502 to "CORE_AUTH_UPSTREAM_ERROR"),
            HttpServerErrorException.create(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, "", HttpHeaders.EMPTY, byteArrayOf(), null) to (503 to "CORE_AUTH_UNAVAILABLE"),
            ResourceAccessException("private connection", java.net.ConnectException()) to (503 to "CORE_AUTH_UNAVAILABLE"),
            ResourceAccessException("private timeout", SocketTimeoutException()) to (504 to "CORE_AUTH_TIMEOUT"),
            RestClientException("private body") to (502 to "CORE_AUTH_INVALID_RESPONSE"),
        )
        for ((error, expected) in errors) {
            var calls = 0
            val service = CoreAuthVerificationService(client { calls++; throw error })
            val failure = assertThrows(CoreAuthException::class.java) { service.verify("Bearer secret") }
            assertEquals(expected.first, failure.status)
            assertEquals(expected.second, failure.code)
            assertFalse(failure.message.orEmpty().contains("private"))
            assertEquals(1, calls, "No retry")
        }
    }
}
