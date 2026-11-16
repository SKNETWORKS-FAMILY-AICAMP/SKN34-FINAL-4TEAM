package ai.storyfork.content.auth

import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.ScheduledMemberPayload
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
        override fun verifyScheduledMember(request: ai.storyfork.content.auth.client.ScheduledMemberPayload) = error("scheduled verification is unused")
    }

    @Test fun `forwards only the bearer and returns the verified UUID without caching`() {
        val id = UUID.randomUUID(); var calls = 0
        val service = CoreAuthVerificationService(client { header ->
            assertEquals("Bearer opaque-user-token", header); calls++; VerifiedMemberResponse(id)
        })
        repeat(2) { assertEquals(id, service.verify("Bearer opaque-user-token").memberId) }
        assertEquals(2, calls)
    }

    @Test fun `verify answers the member and the operator flag while the scheduled check still answers only the member id`() {
        val id = UUID.randomUUID()
        assertEquals(VerifiedMemberResponse(id, true), CoreAuthVerificationService(client { VerifiedMemberResponse(id, true) }).verify("Bearer a"))
        // Core가 operator를 주지 않으면(구 응답) 일반 회원이다.
        assertFalse(CoreAuthVerificationService(client { VerifiedMemberResponse(id) }).verify("Bearer a").operator)
        val scheduled = object : CoreAuthClient {
            override fun verify(authorization: String): VerifiedMemberResponse = error("user verification is unused")
            override fun nicknames(request: NicknamesPayload): NicknamesResponse = throw UnsupportedOperationException("scheduled only")
            override fun verifyScheduledMember(request: ScheduledMemberPayload) = VerifiedMemberResponse(id, true)
        }
        assertEquals(id, CoreAuthVerificationService(scheduled).verifyScheduledMember(id.toString()))
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
