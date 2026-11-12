package ai.storyfork.content.manuscript

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.manuscript.client.ManuscriptQaClient
import ai.storyfork.content.manuscript.client.dto.QaExcerpt
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.springframework.http.HttpStatus
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withStatus
import org.springframework.web.client.RestClient

class ManuscriptQaClientTest {
    @ParameterizedTest
    @CsvSource("403,502", "422,502", "502,502", "503,503")
    fun `AI 거절은 일시 장애와 구분한다`(upstream: Int, expected: Int) {
        val builder = RestClient.builder().baseUrl("http://ai")
        val server = MockRestServiceServer.bindTo(builder).build()
        server.expect(requestTo("http://ai/internal/v1/manuscript/qa")).andRespond(withStatus(HttpStatus.valueOf(upstream)))
        val client = ManuscriptQaClient(builder.build(), "token")

        val failure = assertThrows(ContentFailure::class.java) { client.answer("질문", listOf(QaExcerpt("a", 1, "원문"))) }

        assertEquals(expected, failure.status)
    }
}
