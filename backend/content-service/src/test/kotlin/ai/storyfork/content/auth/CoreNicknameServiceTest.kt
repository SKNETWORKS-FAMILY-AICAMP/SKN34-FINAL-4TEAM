package ai.storyfork.content.auth

import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.VerifiedMemberResponse
import ai.storyfork.content.auth.client.dto.NicknamesPayload
import ai.storyfork.content.auth.client.dto.NicknamesResponse
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreNicknameService
import java.net.ConnectException
import java.net.SocketTimeoutException
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.web.client.*

/** Core는 대역이다. 실제 HTTP 전송·헤더는 CoreAuthClientConfigIntegrationTest가 CI에서 확인한다. */
class CoreNicknameServiceTest {
    /** 호출마다 보낸 id 묶음을 기록하고, [known]에 있는 회원만 돌려주는 Core 대역이다. [fail]이 있으면 매번 그 예외를 던진다. */
    private class FakeCore(private val known: Map<String, String> = emptyMap(), private val fail: Exception? = null) : CoreAuthClient {
        val calls = mutableListOf<List<String>>()
        override fun verify(authorization: String): VerifiedMemberResponse = throw UnsupportedOperationException("nicknames only")
        override fun nicknames(request: NicknamesPayload): NicknamesResponse {
            calls += request.ids
            fail?.let { throw it }
            return NicknamesResponse(request.ids.filter { it in known }.associateWith { known.getValue(it) })
        }
    }

    @Test fun `each distinct id is sent once and members Core does not know are left out`() {
        val core = FakeCore(mapOf("a" to "에이", "b" to "비이"))

        val found = CoreNicknameService(core).nicknames(listOf("a", "b", "a", "gone"))

        assertEquals(mapOf("a" to "에이", "b" to "비이"), found)
        assertEquals(listOf(listOf("a", "b", "gone")), core.calls)
    }

    @Test fun `no ids means no Core call`() {
        val core = FakeCore()

        assertEquals(emptyMap<String, String>(), CoreNicknameService(core).nicknames(emptyList()))

        assertTrue(core.calls.isEmpty())
    }

    @Test fun `more distinct ids than the Core limit of 200 are sent in batches of at most 200`() {
        val ids = (1..201).map { "id-$it" }
        val core = FakeCore(ids.associateWith { "닉-$it" })

        val found = CoreNicknameService(core).nicknames(ids + ids)

        assertEquals(listOf(200, 1), core.calls.map { it.size })
        assertEquals(ids, core.calls.flatten())
        assertEquals(ids.associateWith { "닉-$it" }, found)
    }

    @Test fun `empty upstream body fails as invalid response and never as an empty name`() {
        val service = CoreNicknameService(org.mockito.Mockito.mock(CoreAuthClient::class.java))

        val error = assertThrows(CoreAuthException::class.java) { service.nicknames(listOf("a")) }

        assertEquals(502, error.status)
        assertEquals("CORE_MEMBER_INVALID_RESPONSE", error.code)
    }

    @Test fun `every Core failure is its own error without retry and without a fallback name`() {
        fun response(status: HttpStatus) = HttpClientErrorException.create(status, "", HttpHeaders.EMPTY, byteArrayOf(), null)
        val errors = listOf(
            // 이 호출에는 사용자 Bearer가 없으므로 401·403·400 모두 서비스 연동 실패(502)다. 사용자 401로 오해하지 않는다.
            response(HttpStatus.UNAUTHORIZED) to (502 to "CORE_MEMBER_UPSTREAM_ERROR"),
            response(HttpStatus.FORBIDDEN) to (502 to "CORE_MEMBER_UPSTREAM_ERROR"),
            response(HttpStatus.BAD_REQUEST) to (502 to "CORE_MEMBER_UPSTREAM_ERROR"),
            HttpServerErrorException.create(HttpStatus.INTERNAL_SERVER_ERROR, "", HttpHeaders.EMPTY, byteArrayOf(), null) to (502 to "CORE_MEMBER_UPSTREAM_ERROR"),
            HttpServerErrorException.create(HttpStatus.SERVICE_UNAVAILABLE, "", HttpHeaders.EMPTY, byteArrayOf(), null) to (503 to "CORE_MEMBER_UNAVAILABLE"),
            HttpServerErrorException.create(HttpStatus.GATEWAY_TIMEOUT, "", HttpHeaders.EMPTY, byteArrayOf(), null) to (504 to "CORE_MEMBER_TIMEOUT"),
            ResourceAccessException("private connection", ConnectException()) to (503 to "CORE_MEMBER_UNAVAILABLE"),
            ResourceAccessException("private timeout", SocketTimeoutException()) to (504 to "CORE_MEMBER_TIMEOUT"),
            RestClientException("private body") to (502 to "CORE_MEMBER_INVALID_RESPONSE"),
        )
        for ((error, expected) in errors) {
            val core = FakeCore(fail = error)

            val failure = assertThrows(CoreAuthException::class.java) { CoreNicknameService(core).nicknames(listOf("a")) }

            assertEquals(expected.first, failure.status, error.toString())
            assertEquals(expected.second, failure.code, error.toString())
            assertFalse(failure.message.orEmpty().contains("private"))
            assertEquals(1, core.calls.size, "No retry")
        }
    }
}
