package ai.storyfork.operations.credit

import ai.storyfork.operations._common.RecordingRequestFactory
import ai.storyfork.operations._common.Reply
import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations._common.client.UpstreamRejection
import ai.storyfork.operations._common.client.operationsRestClient
import ai.storyfork.operations.credit.service.dto.CreditAdjustRequest
import java.net.ConnectException
import java.math.BigDecimal
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.http.HttpMethod
import org.springframework.web.server.ResponseStatusException
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** 메모리 요청 팩토리로 Core 크레딧 내부 호출의 메서드·경로·헤더·본문과 오류 변환을 확인한다. 소켓·서버·Spring 컨텍스트가 없다. */
class CoreCreditClientTest {
    private val mapper = jacksonMapperBuilder().build()
    private val memberId = UUID.fromString("5f0c2c7e-8a51-4d6b-9a39-1f4f2b6d0a02")
    private val bearer = "Bearer admin-access"

    private fun client(factory: RecordingRequestFactory) =
        CoreClient(operationsRestClient("http://core.test", "ops-token-1", mapper).requestFactory(factory).build())

    private fun status(call: () -> Unit) = assertThrows(ResponseStatusException::class.java) { call() }.statusCode.value()

    /** 세 호출을 한 번씩. */
    private fun allCalls(client: CoreClient): List<() -> Unit> = listOf(
        { client.credits(bearer, memberId) },
        { client.grantCredits(bearer, memberId, CreditAdjustRequest(BigDecimal(500), "이벤트 보상")) },
        { client.revokeCredits(bearer, memberId, CreditAdjustRequest(BigDecimal(200), "오지급 회수")) },
    )

    @Test
    fun `the balance and history are read for one member with the service token and the admin Bearer and returned as Core sent them`() {
        val answer = """{"balance":{"total":1200,"items":[{"kind":"reward","remaining":1200,"expiresAt":"2026-12-20T00:00:00Z"}]},
            "history":{"items":[{"type":"revoke","kind":"operator","amount":300,"occurredAt":"2026-11-20T01:00:00Z"}]},"future":"kept"}"""
        val factory = RecordingRequestFactory { Reply(200, answer) }

        val credits = client(factory).credits(bearer, memberId)

        val call = factory.calls.single()
        assertEquals(HttpMethod.GET, call.method)
        assertEquals("/internal/v1/credits/members/$memberId", call.uri.path)
        assertEquals("ops-token-1", call.headers.getFirst("X-Operations-Service-Token"))
        assertEquals(bearer, call.headers.getFirst("Authorization"))
        assertEquals(mapper.readTree(answer), credits)
    }

    @Test
    fun `a grant and a revocation are posted with the amount and the reason and Core's updated balance is returned as is`() {
        val answer = """{"total":1700,"items":[{"kind":"operator","remaining":500,"expiresAt":"2026-12-20T00:00:00Z"}]}"""
        val factory = RecordingRequestFactory { Reply(201, answer) }

        val granted = client(factory).grantCredits(bearer, memberId, CreditAdjustRequest(BigDecimal(500), "이벤트 보상"))
        val revoked = client(factory).revokeCredits(bearer, memberId, CreditAdjustRequest(BigDecimal(200), "오지급 회수"))

        assertEquals(listOf(HttpMethod.POST, HttpMethod.POST), factory.calls.map { it.method })
        assertEquals(listOf("/internal/v1/credits/members/$memberId/grants", "/internal/v1/credits/members/$memberId/revocations"), factory.calls.map { it.uri.path })
        for (call in factory.calls) {
            assertEquals("ops-token-1", call.headers.getFirst("X-Operations-Service-Token"))
            assertEquals(bearer, call.headers.getFirst("Authorization"))
            assertEquals("application/json", call.headers.contentType.toString())
        }
        assertEquals(mapper.readTree("""{"amount":500,"reason":"이벤트 보상"}"""), mapper.readTree(factory.calls[0].body))
        assertEquals(mapper.readTree("""{"amount":200,"reason":"오지급 회수"}"""), mapper.readTree(factory.calls[1].body))
        assertEquals(mapper.readTree(answer), granted)
        assertEquals(mapper.readTree(answer), revoked)
    }

    @Test
    fun `400 404 409 and 422 keep their status and every other failure or a lost connection is 502`() {
        for ((upstream, expected) in listOf(400 to 400, 404 to 404, 409 to 409, 422 to 422, 401 to 502, 403 to 502, 500 to 502, 503 to 502)) {
            val client = client(RecordingRequestFactory { Reply(upstream, """{"detail":"x"}""") })
            for (call in allCalls(client)) assertEquals(expected, status(call), upstream.toString())
        }
        val lost = client(RecordingRequestFactory { throw ConnectException("refused") })
        for (call in allCalls(lost)) assertEquals(502, status(call))
    }

    @Test
    fun `an empty answer is a 502 for every call, never a success`() {
        val client = client(RecordingRequestFactory { Reply(200, "") })

        for (call in allCalls(client)) assertEquals(502, status(call))
    }

    @Test
    fun `a Core rejection keeps its own message and code and a 404 without a body stays a plain 404`() {
        val insufficient = "사용 가능한 크레딧이 부족합니다."
        val revoke = client(RecordingRequestFactory { Reply(409, """{"title":"Conflict","status":409,"detail":"$insufficient","code":"CREDIT_INSUFFICIENT"}""") })
        val invalid = client(RecordingRequestFactory { Reply(422, """{"status":422,"detail":"금액은 1~100000이어야 합니다.","code":"INVALID_CREDIT_REQUEST"}""") })
        val missing = client(RecordingRequestFactory { Reply(404) })

        val conflict = assertThrows(UpstreamRejection::class.java) { revoke.revokeCredits(bearer, memberId, CreditAdjustRequest(BigDecimal(999), "회수")) }
        val rule = assertThrows(UpstreamRejection::class.java) { invalid.grantCredits(bearer, memberId, CreditAdjustRequest(BigDecimal(0), "지급")) }
        val notFound = assertThrows(ResponseStatusException::class.java) { missing.credits(bearer, memberId) }

        assertEquals(409, conflict.statusCode.value())
        assertEquals(insufficient, conflict.userMessage)
        assertEquals("CREDIT_INSUFFICIENT", conflict.code)
        assertEquals(422, rule.statusCode.value())
        assertEquals("INVALID_CREDIT_REQUEST", rule.code)
        assertEquals(404, notFound.statusCode.value())
        assertFalse(notFound is UpstreamRejection)
    }
}
