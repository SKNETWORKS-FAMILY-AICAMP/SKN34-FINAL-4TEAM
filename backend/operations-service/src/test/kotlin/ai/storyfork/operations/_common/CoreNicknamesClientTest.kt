package ai.storyfork.operations._common

import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations._common.client.operationsRestClient
import java.net.ConnectException
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.http.HttpMethod
import org.springframework.web.server.ResponseStatusException
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** 메모리 요청 팩토리로 Core 닉네임 일괄 조회의 메서드·경로·헤더·본문, 200개 나눔, 오류 변환을 확인한다. 소켓·서버·Spring 컨텍스트가 없다. */
class CoreNicknamesClientTest {
    private val mapper = jacksonMapperBuilder().build()

    private fun client(factory: RecordingRequestFactory) =
        CoreClient(operationsRestClient("http://core.test", "ops-token-1", mapper).requestFactory(factory).build())

    private fun status(call: () -> Unit) = assertThrows(ResponseStatusException::class.java) { call() }.statusCode.value()

    private fun id(n: Int) = UUID(0L, n.toLong()).toString()

    private fun asked(call: RecordedCall) = mapper.readTree(call.body).path("ids").values().map { it.asString() }

    /** Core's answer when it knows every id asked: the nickname is "닉-<id>". */
    private fun answerAll(call: RecordedCall) = Reply(200, mapper.writeValueAsString(mapOf("nicknames" to asked(call).associateWith { "닉-$it" })))

    @Test
    fun `the distinct ids are posted in one call with only the service token and Core's nicknames come back as a map, an unknown member left out`() {
        val known = id(1)
        val unknown = id(2)
        val factory = RecordingRequestFactory { Reply(200, """{"nicknames":{"${known}":"작가"}}""") }

        val found = client(factory).nicknames(listOf(known, unknown, known))

        val call = factory.calls.single()
        assertEquals(HttpMethod.POST, call.method)
        assertEquals("/internal/v1/members/nicknames", call.uri.path)
        assertEquals("ops-token-1", call.headers.getFirst("X-Operations-Service-Token"))
        assertNull(call.headers.getFirst("Authorization"))
        assertEquals("application/json", call.headers.contentType.toString())
        assertEquals(mapper.readTree("""{"ids":["${known}","${unknown}"]}"""), mapper.readTree(call.body))
        assertEquals(mapOf(known to "작가"), found)
    }

    @Test
    fun `more than the 200 ids Core takes per call are sent in turns and the answers are merged`() {
        val ids = (1..450).map { id(it) }
        val factory = RecordingRequestFactory { answerAll(it) }

        val found = client(factory).nicknames(ids)

        assertEquals(listOf(200, 200, 50), factory.calls.map { asked(it).size })
        assertEquals(ids.associateWith { "닉-$it" }, found)
    }

    @Test
    fun `no id means no call`() {
        val factory = RecordingRequestFactory { answerAll(it) }

        assertEquals(emptyMap<String, String>(), client(factory).nicknames(emptyList()))
        assertTrue(factory.calls.isEmpty())
    }

    @Test
    fun `every failure is a 502, a rejected id and a lost connection included, and a failed later call leaves no partial map`() {
        for (code in listOf(400, 401, 403, 404, 409, 422, 500, 503)) {
            val failing = RecordingRequestFactory { Reply(code, """{"detail":"x"}""") }
            assertEquals(502, status { client(failing).nicknames(listOf(id(1))) }, code.toString())
        }
        assertEquals(502, status { client(RecordingRequestFactory { throw ConnectException("refused") }).nicknames(listOf(id(1))) })
        assertEquals(502, status { client(RecordingRequestFactory { Reply(200, "") }).nicknames(listOf(id(1))) })
        // The second call (50 ids) fails: the nicknames of the first 200 are not handed out on their own.
        val secondFails = RecordingRequestFactory { if (asked(it).size == 50) Reply(503) else answerAll(it) }
        assertEquals(502, status { client(secondFails).nicknames((1..250).map { id(it) }) })
    }
}
