package ai.storyfork.operations._common

import ai.storyfork.operations._common.client.UpstreamRejection
import ai.storyfork.operations._common.client.upstream
import java.nio.charset.StandardCharsets
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.web.client.HttpClientErrorException
import org.springframework.web.client.HttpServerErrorException
import org.springframework.web.server.ResponseStatusException

/** `upstream`의 오류 변환만 본다. 가짜 응답 예외를 던질 뿐 HTTP 클라이언트·서버·Spring이 없다. */
class UpstreamTest {
    private val message = "원작의 고정 기준 기록을 확인할 수 없어요."

    // 응답 헤더에 charset이 없어도 JSON 본문은 UTF-8로 읽어야 한글이 깨지지 않는다.
    private fun clientError(status: HttpStatus, body: String) =
        HttpClientErrorException.create(status, status.reasonPhrase, HttpHeaders(), body.toByteArray(StandardCharsets.UTF_8), null)

    private fun failure(keepMessage: Boolean, error: Exception) =
        assertThrows(ResponseStatusException::class.java) { upstream<String>(keepMessage = keepMessage) { throw error } }

    @Test
    fun `Content's detail text is kept for preserved statuses when the call asks for it`() {
        for (status in listOf(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)) {
            val rejected = failure(true, clientError(status, """{"detail":"$message"}"""))

            assertTrue(rejected is UpstreamRejection, status.toString())
            assertEquals(status, rejected.statusCode)
            assertEquals(message, (rejected as UpstreamRejection).userMessage)
        }
    }

    @Test
    fun `by default the same failure keeps only its status`() {
        val rejected = failure(false, clientError(HttpStatus.CONFLICT, """{"detail":"$message"}"""))

        assertFalse(rejected is UpstreamRejection)
        assertEquals(HttpStatus.CONFLICT, rejected.statusCode)
    }

    @Test
    fun `without usable detail text the status alone is kept`() {
        for (body in listOf("", "not-json", "{}", """{"detail":""}""", """{"detail":"  "}""", """{"detail":5}""", """{"detail":null}""", "[1]")) {
            val rejected = failure(true, clientError(HttpStatus.NOT_FOUND, body))

            assertFalse(rejected is UpstreamRejection, body)
            assertEquals(HttpStatus.NOT_FOUND, rejected.statusCode, body)
        }
    }

    @Test
    fun `statuses that are not preserved stay 502 and never carry the text`() {
        val json = """{"detail":"$message"}"""
        for (error in listOf(
            clientError(HttpStatus.FORBIDDEN, json),
            HttpServerErrorException.create(HttpStatus.SERVICE_UNAVAILABLE, "Service Unavailable", HttpHeaders(), json.toByteArray(StandardCharsets.UTF_8), null),
        )) {
            val rejected = failure(true, error)

            assertFalse(rejected is UpstreamRejection, error.statusCode.toString())
            assertEquals(HttpStatus.BAD_GATEWAY, rejected.statusCode)
        }
    }
}
