package ai.storyfork.operations._common

import ai.storyfork.operations._common.client.AiClient
import ai.storyfork.operations._common.client.aiRestClient
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.http.HttpMethod
import org.springframework.web.server.ResponseStatusException
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** 메모리 요청 팩토리로 AI 내부 호출의 헤더·본문·응답 읽기를 확인한다. 소켓·서버·Spring 컨텍스트가 없다. */
class AiClientTest {
    private val mapper = jacksonMapperBuilder().build()

    private fun client(factory: RecordingRequestFactory) = AiClient(aiRestClient("http://ai.test", "internal-token-1", mapper).requestFactory(factory).build())

    private fun status(call: () -> Unit) = assertThrows(ResponseStatusException::class.java) { call() }.statusCode.value()

    @Test
    fun `an evaluation request carries only the internal token and reads the run name from the 202`() {
        val factory = RecordingRequestFactory { Reply(202, """{"runName":"qa-answer-v3-20261119"}""") }

        val started = client(factory).startEvaluation("qa-regression", "qa/answer", 3)

        val call = factory.calls.single()
        assertEquals("qa-answer-v3-20261119", started.runName)
        assertEquals(HttpMethod.POST, call.method)
        assertEquals("/internal/v1/evaluations", call.uri.path)
        assertEquals("internal-token-1", call.headers.getFirst("X-Internal-Token"))
        assertNull(call.headers.getFirst("X-Operations-Service-Token"))
        assertNull(call.headers.getFirst("Authorization"))
        assertEquals("application/json", call.headers.contentType.toString())
        val body = mapper.readTree(call.body)
        assertEquals(3, body.size())
        assertEquals("qa-regression", body.path("dataset").asString())
        assertEquals("qa/answer", body.path("prompt").asString())
        assertEquals(3, body.path("version").asInt())
    }

    @Test
    fun `a leak check sends the response and the matched references and reads the verdict`() {
        val factory = RecordingRequestFactory { Reply(200, """{"suspected":true,"reason":"비공개 카드 제목을 그대로 말했어요"}""") }

        val verdict = client(factory).leakCheck("그 사람의 진짜 이름은 한서진이야", listOf("한서진"))

        val call = factory.calls.single()
        assertEquals("/internal/v1/evaluations/leak-check", call.uri.path)
        assertEquals("internal-token-1", call.headers.getFirst("X-Internal-Token"))
        assertTrue(verdict.suspected)
        assertEquals("비공개 카드 제목을 그대로 말했어요", verdict.reason)
        val body = mapper.readTree(call.body)
        assertEquals("그 사람의 진짜 이름은 한서진이야", body.path("response").asString())
        assertEquals(listOf("한서진"), body.path("references").values().map { it.asString() })
        assertFalse(client(RecordingRequestFactory { Reply(200, """{"suspected":false}""") }).leakCheck("x", listOf("y")).suspected)
    }

    @Test
    fun `a leak check sends the question the user asked, and null when there was none`() {
        val factory = RecordingRequestFactory { Reply(200, """{"suspected":false}""") }

        client(factory).leakCheck("율도국은 근거를 찾지 못했어요", listOf("길현"), "율도국에서 길현은 누구야?")
        client(factory).leakCheck("x", listOf("y"))

        val bodies = factory.calls.map { mapper.readTree(it.body) }
        assertEquals("율도국에서 길현은 누구야?", bodies[0].path("question").asString())
        // The field is always sent: null says the trace had no question, so the judge never has to guess whether a caller left it out.
        assertTrue(bodies[1].path("question").isNull)
        assertEquals(listOf("response", "references", "question"), bodies[1].propertyNames().toList())
    }

    @Test
    fun `400 404 and 409 keep their status and every other failure or an empty reply is 502`() {
        for ((upstream, expected) in listOf(400 to 400, 404 to 404, 409 to 409, 401 to 502, 403 to 502, 422 to 502, 500 to 502, 503 to 502)) {
            val factory = RecordingRequestFactory { Reply(upstream, """{"detail":"x"}""") }
            assertEquals(expected, status { client(factory).startEvaluation("d", "p", 1) }, upstream.toString())
            assertEquals(expected, status { client(factory).leakCheck("r", listOf("x")) }, upstream.toString())
        }
        assertEquals(502, status { client(RecordingRequestFactory { Reply(200, "") }).startEvaluation("d", "p", 1) })
    }
}
