package ai.storyfork.operations.feedbackreport

import ai.storyfork.operations._common.RecordingRequestFactory
import ai.storyfork.operations._common.Reply
import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.UpstreamRejection
import ai.storyfork.operations._common.client.operationsRestClient
import java.net.ConnectException
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.http.HttpMethod
import org.springframework.web.server.ResponseStatusException
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** 메모리 요청 팩토리로 Content 제보 열람 호출의 메서드·경로·헤더·쿼리와 오류 변환을 확인한다. 소켓·서버·Spring 컨텍스트가 없다. */
class FeedbackReportContentClientTest {
    private val mapper = jacksonMapperBuilder().build()

    private fun client(factory: RecordingRequestFactory) =
        ContentClient(operationsRestClient("http://content.test", "ops-token-1", mapper).requestFactory(factory).build())

    private fun status(call: () -> Unit) = assertThrows(ResponseStatusException::class.java) { call() }.statusCode.value()

    @Test
    fun `the page is read with only the service token and the given filter as query and returned as Content sent it`() {
        val rows = """{"items":[{"id":"r1","workTitle":"작품","status":"checked","future":"kept"}],"page":2,"size":5,"totalElements":11,"totalPages":3}"""
        val factory = RecordingRequestFactory { Reply(200, rows) }

        val page = client(factory).feedbackReports("checked", 2, 5)

        val call = factory.calls.single()
        assertEquals(HttpMethod.GET, call.method)
        assertEquals("/internal/v1/feedback-reports", call.uri.path)
        assertEquals(mapOf("status" to listOf("checked"), "page" to listOf("2"), "size" to listOf("5")), call.query)
        assertEquals("ops-token-1", call.headers.getFirst("X-Operations-Service-Token"))
        assertNull(call.headers.getFirst("Authorization"))
        assertEquals(mapper.readTree(rows), page)
    }

    @Test
    fun `only the parameters that were given are sent so Content keeps its own defaults`() {
        val factory = RecordingRequestFactory { Reply(200, """{"items":[]}""") }

        client(factory).feedbackReports(null, null, null)
        client(factory).feedbackReports(null, 1, null)

        assertNull(factory.calls[0].uri.query)
        assertEquals(mapOf("page" to listOf("1")), factory.calls[1].query)
    }

    @Test
    fun `400 404 409 and 422 keep their status and every other failure, a lost connection or an empty answer is 502 and never a success`() {
        for ((upstream, expected) in listOf(400 to 400, 404 to 404, 409 to 409, 422 to 422, 401 to 502, 403 to 502, 500 to 502, 503 to 502)) {
            assertEquals(expected, status { client(RecordingRequestFactory { Reply(upstream, """{"detail":"x"}""") }).feedbackReports(null, null, null) }, upstream.toString())
        }
        assertEquals(502, status { client(RecordingRequestFactory { throw ConnectException("refused") }).feedbackReports(null, null, null) })
        assertEquals(502, status { client(RecordingRequestFactory { Reply(200, "") }).feedbackReports(null, null, null) })
    }

    @Test
    fun `a Content rejection keeps its own message so the admin can read what to fix`() {
        val client = client(RecordingRequestFactory { Reply(422, """{"detail":"status 값을 확인해 주세요."}""") })

        val rejected = assertThrows(UpstreamRejection::class.java) { client.feedbackReports("held", null, null) }

        assertEquals(422, rejected.statusCode.value())
        assertEquals("status 값을 확인해 주세요.", rejected.userMessage)
    }
}
