package ai.storyfork.content.auth

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.client.CoreMemberClient
import ai.storyfork.content.auth.client.dto.NicknamesPayload
import ai.storyfork.content.auth.client.dto.NicknamesResult
import ai.storyfork.content.auth.service.MemberNicknameService
import java.net.SocketTimeoutException
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.web.client.*

class MemberNicknameServiceTest {
    private val calls = mutableListOf<List<UUID>>()
    private fun name(id: UUID) = "이름-${id.toString().take(8)}"

    /** Core 대역: 요청한 ID마다 [name]을 돌려주되 [absent]는 모른 척한다. */
    private fun service(absent: Set<UUID> = emptySet(), call: (NicknamesPayload) -> NicknamesResult = { body ->
        NicknamesResult(body.ids.filter { it !in absent }.associate { it.toString() to name(it) })
    }) = MemberNicknameService(object : CoreMemberClient {
        override fun nicknames(body: NicknamesPayload): NicknamesResult { calls += body.ids; return call(body) }
    })

    @Test fun `owner ids are collected into one Core call and only known members come back`() {
        val a = UUID.randomUUID(); val b = UUID.randomUUID(); val gone = UUID.randomUUID()

        val names = service(absent = setOf(gone)).nicknames(listOf(a.toString(), b.toString(), a.toString(), gone.toString()))

        assertEquals(listOf(listOf(a, b, gone)), calls, "중복은 한 번만 보내고 응답 하나에 한 번 호출한다")
        assertEquals(mapOf(a.toString() to name(a), b.toString() to name(b)), names)
    }

    @Test fun `non UUID owners are never sent to Core and nothing to look up makes no call`() {
        val a = UUID.randomUUID()

        assertEquals(setOf(a.toString()), service().nicknames(listOf("author", "", a.toString(), "forged-owner")).keys)
        assertEquals(listOf(listOf(a)), calls)

        calls.clear()
        assertEquals(emptyMap<String, String>(), service().nicknames(listOf("author", "legacy")))
        assertEquals(emptyMap<String, String>(), service().nicknames(emptyList()))
        assertTrue(calls.isEmpty())
    }

    @Test fun `more than 200 owners are split into requests Core accepts`() {
        val ids = List(450) { UUID.randomUUID() }

        val names = service().nicknames(ids.map { it.toString() })

        assertEquals(listOf(200, 200, 50), calls.map { it.size })
        assertEquals(ids, calls.flatten())
        assertEquals(ids.map { it.toString() }.toSet(), names.keys)
    }

    @Test fun `every Core failure is a 503 with no substitute name and no retry`() {
        val failures = listOf<Throwable>(
            ResourceAccessException("private connection", java.net.ConnectException()),
            ResourceAccessException("private timeout", SocketTimeoutException()),
            HttpServerErrorException.create(HttpStatus.SERVICE_UNAVAILABLE, "", HttpHeaders.EMPTY, byteArrayOf(), null),
            HttpClientErrorException.create(HttpStatus.FORBIDDEN, "", HttpHeaders.EMPTY, byteArrayOf(), null),
            HttpClientErrorException.create(HttpStatus.BAD_REQUEST, "", HttpHeaders.EMPTY, byteArrayOf(), null),
            RestClientException("private body"),
        )
        for (failure in failures) {
            calls.clear()
            val error = assertThrows(ContentFailure::class.java) { service(call = { throw failure }).nicknames(listOf(UUID.randomUUID().toString())) }
            assertEquals(503, error.status, failure.toString())
            assertFalse(error.message.contains("private"))
            assertEquals(1, calls.size, "No retry")
        }
    }

    @Test fun `an empty upstream body is an invalid response not an empty member list`() {
        val empty = MemberNicknameService(mock(CoreMemberClient::class.java))

        assertEquals(503, assertThrows(ContentFailure::class.java) { empty.nicknames(listOf(UUID.randomUUID().toString())) }.status)
    }

    @Test fun `a failing chunk fails the whole lookup instead of returning a partial map`() {
        var n = 0
        val failing = service(call = { body -> if (++n == 2) throw RestClientException("second chunk") else NicknamesResult(body.ids.associate { it.toString() to "x" }) })

        assertEquals(503, assertThrows(ContentFailure::class.java) { failing.nicknames(List(250) { UUID.randomUUID().toString() }) }.status)
    }
}
