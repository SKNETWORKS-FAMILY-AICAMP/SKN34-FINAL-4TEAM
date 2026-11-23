package ai.storyfork.operations.credit

import ai.storyfork.operations.credit.controller.CreditController
import ai.storyfork.operations.credit.service.CreditService
import ai.storyfork.operations.credit.service.dto.CreditAdjustRequest
import ai.storyfork.operations.credit.service.dto.CreditBalancesRequest
import ai.storyfork.operations.security.OperationsMember
import java.math.BigDecimal
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** Spring context나 HTTP 서버 없이 인증 회원·Bearer·경로 값·본문이 서비스에 그대로 가고 서비스 결과가 그대로 나오는지 확인한다. */
class CreditControllerTest {
    private val service = mock(CreditService::class.java)
    private val controller = CreditController(service)
    private val member = OperationsMember(UUID.randomUUID(), true)
    private val bearer = "Bearer admin-access"
    private val memberId = UUID.randomUUID()
    private val mapper = jacksonMapperBuilder().build()
    private val overview = mapper.readTree("""{"balance":{"total":1200,"items":[]},"history":{"items":[]}}""")
    private val updated = mapper.readTree("""{"total":1700,"items":[]}""")

    @Test
    fun `the browser's JSON keeps a fractional amount and leaves a missing field null so that Core, not a cast here, refuses them`() {
        assertEquals(CreditAdjustRequest(BigDecimal("1.5"), null), mapper.readValue("""{"amount":1.5}""", CreditAdjustRequest::class.java))
        assertEquals(CreditAdjustRequest(null, "사유"), mapper.readValue("""{"reason":"사유"}""", CreditAdjustRequest::class.java))
    }

    @Test
    fun `every route passes the member, the forwarded bearer, the path member and the body on and returns the service JSON as is`() {
        val grant = CreditAdjustRequest(BigDecimal(500), "이벤트 보상")
        val revoke = CreditAdjustRequest(BigDecimal(200), "오지급 회수")
        `when`(service.read(member, bearer, memberId)).thenReturn(overview)
        `when`(service.grant(member, bearer, memberId, grant)).thenReturn(updated)
        `when`(service.revoke(member, bearer, memberId, revoke)).thenReturn(updated)

        assertSame(overview, controller.read(member, bearer, memberId))
        assertSame(updated, controller.grant(member, bearer, memberId, grant))
        assertSame(updated, controller.revoke(member, bearer, memberId, revoke))
    }

    @Test
    fun `the balances route passes the member, the forwarded bearer and the member ids on and returns the service JSON as is`() {
        val request = CreditBalancesRequest(listOf(memberId, UUID.randomUUID()))
        val rows = mapper.readTree("""[{"memberId":"${memberId}","total":1200}]""")
        `when`(service.balances(member, bearer, request)).thenReturn(rows)

        assertSame(rows, controller.balances(member, bearer, request))
        assertEquals(CreditBalancesRequest(listOf(memberId)), mapper.readValue("""{"memberIds":["${memberId}"]}""", CreditBalancesRequest::class.java))
    }
}
