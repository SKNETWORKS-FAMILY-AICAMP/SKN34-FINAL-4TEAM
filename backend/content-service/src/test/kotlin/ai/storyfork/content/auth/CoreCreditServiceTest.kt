package ai.storyfork.content.auth

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.dto.CreditReleasePayload
import ai.storyfork.content.auth.client.dto.CreditReservationResponse
import ai.storyfork.content.auth.client.dto.CreditReservePayload
import ai.storyfork.content.auth.client.dto.CreditSettlePayload
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreCreditService
import java.io.IOException
import java.math.BigDecimal
import java.net.SocketTimeoutException
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.HttpStatusCode
import org.springframework.web.client.HttpClientErrorException
import org.springframework.web.client.HttpServerErrorException
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.client.ResourceAccessException
import org.springframework.web.service.annotation.PostExchange

/** Content가 Core 크레딧 내부 API(예약·정산·해제)를 부르는 방식과 오류 변환을 고정한다. 서비스 자격은 HTTP proxy 설정이 주입한다. */
class CoreCreditServiceTest {
    private val client = mock(CoreAuthClient::class.java)
    private val service = CoreCreditService(client)
    private val member = "00000000-0000-0000-0000-000000000001"
    private val reservation = CreditReservationResponse("r1", "serial-run:b1", "reserved", BigDecimal("50"), null)

    private fun conflict(body: String) = HttpClientErrorException.create(HttpStatusCode.valueOf(409), "Conflict", HttpHeaders.EMPTY, body.toByteArray(), Charsets.UTF_8)
    private fun server(status: Int) = HttpServerErrorException.create(HttpStatusCode.valueOf(status), "x", HttpHeaders.EMPTY, ByteArray(0), Charsets.UTF_8)

    @Test fun `the three calls carry the Core payloads`() {
        val reserve = CreditReservePayload(member, "serial-run:b1", BigDecimal("50"))
        val settle = CreditSettlePayload(member, "serial-run:b1", BigDecimal("1.2345"))
        val release = CreditReleasePayload(member, "serial-run:b1")
        `when`(client.reserveCredit(reserve)).thenReturn(reservation)
        `when`(client.settleCredit(settle)).thenReturn(reservation.copy(status = "settled"))
        `when`(client.releaseCredit(release)).thenReturn(reservation.copy(status = "released"))

        assertEquals("r1", service.reserve(member, "serial-run:b1", BigDecimal("50")))
        service.settle(member, "serial-run:b1", BigDecimal("1.2345"))
        service.release(member, "serial-run:b1")

        verify(client).reserveCredit(reserve)
        verify(client).settleCredit(settle)
        verify(client).releaseCredit(release)
    }

    @Test fun `not enough credit is a conflict with its code and a fixed message`() {
        val body = """{"type":"about:blank","title":"Conflict","status":409,"detail":"크레딧이 부족합니다.","code":"INSUFFICIENT_CREDIT"}"""
        `when`(client.reserveCredit(CreditReservePayload(member, "k", BigDecimal("5")))).thenThrow(conflict(body))

        val failure = assertThrows(ContentFailure::class.java) { service.reserve(member, "k", BigDecimal("5")) }

        assertEquals(listOf(409, "INSUFFICIENT_CREDIT", "크레딧이 부족합니다."), listOf(failure.status, failure.code, failure.message))
    }

    @Test fun `other Core answers are service errors not a shortage`() {
        `when`(client.reserveCredit(CreditReservePayload(member, "closed", BigDecimal("5")))).thenThrow(conflict("""{"code":"RESERVATION_CLOSED"}"""))
        `when`(client.reserveCredit(CreditReservePayload(member, "bad", BigDecimal("5")))).thenThrow(HttpClientErrorException.create(HttpStatusCode.valueOf(422), "x", HttpHeaders.EMPTY, ByteArray(0), Charsets.UTF_8))
        `when`(client.reserveCredit(CreditReservePayload(member, "down", BigDecimal("5")))).thenThrow(server(503))
        `when`(client.reserveCredit(CreditReservePayload(member, "slow", BigDecimal("5")))).thenThrow(server(504))

        fun status(key: String) = assertThrows(CoreAuthException::class.java) { service.reserve(member, key, BigDecimal("5")) }.status

        assertEquals(listOf(502, 502, 503, 504), listOf(status("closed"), status("bad"), status("down"), status("slow")))
    }

    @Test fun `a network failure is unavailable and a slow one is a timeout`() {
        `when`(client.settleCredit(CreditSettlePayload(member, "a", BigDecimal.ONE))).thenThrow(ResourceAccessException("down", IOException("refused")))
        `when`(client.settleCredit(CreditSettlePayload(member, "b", BigDecimal.ONE))).thenThrow(ResourceAccessException("slow", SocketTimeoutException("read")))

        assertEquals(503, assertThrows(CoreAuthException::class.java) { service.settle(member, "a", BigDecimal.ONE) }.status)
        assertEquals(504, assertThrows(CoreAuthException::class.java) { service.settle(member, "b", BigDecimal.ONE) }.status)
    }

    @Test fun `an empty Core answer is not treated as success`() {
        `when`(client.releaseCredit(CreditReleasePayload(member, "k"))).thenReturn(null)
        `when`(client.reserveCredit(CreditReservePayload(member, "k", BigDecimal.ONE))).thenReturn(null)

        assertEquals(502, assertThrows(CoreAuthException::class.java) { service.release(member, "k") }.status)
        assertEquals(502, assertThrows(CoreAuthException::class.java) { service.reserve(member, "k", BigDecimal.ONE) }.status)
    }

    @Test fun `the three exchanges declare the Core paths with JSON bodies and no user bearer`() {
        val declared = listOf(
            Triple("reserveCredit", CreditReservePayload::class.java, "/internal/v1/credits/reservations"),
            Triple("settleCredit", CreditSettlePayload::class.java, "/internal/v1/credits/reservations/settle"),
            Triple("releaseCredit", CreditReleasePayload::class.java, "/internal/v1/credits/reservations/release"),
        )
        for ((name, payload, path) in declared) {
            val method = CoreAuthClient::class.java.getDeclaredMethod(name, payload)
            assertEquals(path, method.getAnnotation(PostExchange::class.java)?.value, name)
            assertEquals(MediaType.APPLICATION_JSON_VALUE, method.getAnnotation(PostExchange::class.java)?.contentType, name)
            // 서비스 토큰(HTTP proxy 기본 헤더)만 보내므로 요청 본문 말고는 파라미터가 없다.
            assertNotNull(method.parameters.single().getAnnotation(RequestBody::class.java), name)
            assertEquals(CreditReservationResponse::class.java, method.returnType, name)
        }
        assertEquals(listOf("memberId" to String::class.java, "operationKey" to String::class.java, "amount" to BigDecimal::class.java),
            CreditReservePayload::class.java.declaredFields.filterNot { it.isSynthetic }.map { it.name to it.type })
        assertEquals(listOf("memberId" to String::class.java, "operationKey" to String::class.java, "actual" to BigDecimal::class.java),
            CreditSettlePayload::class.java.declaredFields.filterNot { it.isSynthetic }.map { it.name to it.type })
        assertEquals(listOf("memberId" to String::class.java, "operationKey" to String::class.java),
            CreditReleasePayload::class.java.declaredFields.filterNot { it.isSynthetic }.map { it.name to it.type })
    }
}
