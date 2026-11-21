package ai.storyfork.operations.dashboard

import ai.storyfork.operations._common.RecordingRequestFactory
import ai.storyfork.operations._common.Reply
import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.operationsRestClient
import java.net.ConnectException
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.http.HttpMethod
import org.springframework.web.server.ResponseStatusException
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** 메모리 요청 팩토리로 Content 퍼널 집계 호출의 메서드·경로·헤더와 오류 변환을 확인한다. 소켓·서버·Spring 컨텍스트가 없다. */
class FunnelContentClientTest {
    private val mapper = jacksonMapperBuilder().build()

    private fun client(factory: RecordingRequestFactory) =
        ContentClient(operationsRestClient("http://content.test", "ops-token-1", mapper).requestFactory(factory).build())

    private fun status(call: () -> Unit) = assertThrows(ResponseStatusException::class.java) { call() }.statusCode.value()

    @Test
    fun `the funnel is read without parameters and with only the service token and returned as Content sent it`() {
        val counts = """{"readers":{"viewed":12,"readAny":9,"readNext":4},"reactions":{"publishedEpisodes":6,"likes":30,"interests":8,"comments":5},
            "forks":{"readers":9,"readerForked":2,"baseEpisodes":[{"bucket":"1","count":1},{"bucket":"2","count":0},{"bucket":"3","count":1},{"bucket":"4-5","count":0},{"bucket":"6-10","count":0},{"bucket":"11+","count":0}]},
            "writers":{"forks":2,"saved":1,"published":1,"medianHoursToPublish":5.5},"proposals":{"adopted":3,"total":8},"feedback":{"approved":2,"decided":3},"future":"kept"}"""
        val factory = RecordingRequestFactory { Reply(200, counts) }

        val funnel = client(factory).funnel()

        val call = factory.calls.single()
        assertEquals(HttpMethod.GET, call.method)
        assertEquals("/internal/v1/operations/funnel", call.uri.path)
        // The whole period is fixed by Content, so nothing is asked for.
        assertNull(call.uri.query)
        assertEquals("ops-token-1", call.headers.getFirst("X-Operations-Service-Token"))
        assertNull(call.headers.getFirst("Authorization"))
        assertEquals(mapper.readTree(counts), funnel)
    }

    @Test
    fun `any failure answer, a lost connection or an empty body is a failed call and never a success`() {
        for (upstream in listOf(400, 401, 404, 500, 503)) status { client(RecordingRequestFactory { Reply(upstream, """{"detail":"x"}""") }).funnel() }
        status { client(RecordingRequestFactory { throw ConnectException("refused") }).funnel() }
        assertEquals(502, status { client(RecordingRequestFactory { Reply(200, "") }).funnel() })
    }
}
