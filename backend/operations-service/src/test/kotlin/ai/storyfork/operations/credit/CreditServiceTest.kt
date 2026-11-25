package ai.storyfork.operations.credit

import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations._common.client.UpstreamRejection
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.credit.service.CreditService
import ai.storyfork.operations.credit.service.dto.CreditAdjustRequest
import ai.storyfork.operations.credit.service.dto.CreditBalancesRequest
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.security.OperationsMember
import java.math.BigDecimal
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** Core 클라이언트·권한 저장소·활동 기록은 Mockito 대역이다. Spring 컨텍스트·HTTP·DB가 없다. */
class CreditServiceTest {
    private val core = mock(CoreClient::class.java)
    private val permissions = mock(AdminPermissionRepository::class.java)
    private val activities = mock(AdminActivityService::class.java)
    private val service = CreditService(core, permissions, activities)
    private val mapper = jacksonMapperBuilder().build()
    private val admin = OperationsMember(UUID.randomUUID(), true)
    private val operatorWithoutCredits = OperationsMember(UUID.randomUUID(), true)
    private val staleGrant = OperationsMember(UUID.randomUUID(), false)
    private val bearer = "Bearer admin-access"
    private val target = UUID.randomUUID()
    private val overview = mapper.readTree("""{"balance":{"total":1200,"items":[]},"history":{"items":[{"type":"grant","kind":"operator","amount":500}]}}""")
    private val updated = mapper.readTree("""{"total":1700,"items":[{"kind":"operator","remaining":500}]}""")

    private fun grantCredits(vararg members: OperationsMember) = members.forEach {
        `when`(permissions.existsByMemberIdAndPermission(it.memberId, "credits")).thenReturn(true)
    }

    private fun status(call: () -> Unit) = assertThrows(ResponseStatusException::class.java) { call() }.statusCode

    @Test
    fun `read returns Core's balance and history untouched and records nothing`() {
        grantCredits(admin)
        `when`(core.credits(bearer, target)).thenReturn(overview)

        assertSame(overview, service.read(admin, bearer, target))
        verifyNoInteractions(activities)
    }

    @Test
    fun `grant returns the updated balance untouched and records the member, the amount and the trimmed reason after Core succeeded`() {
        grantCredits(admin)
        val request = CreditAdjustRequest(BigDecimal(500), "  이벤트 보상  ")
        `when`(core.grantCredits(bearer, target, request)).thenReturn(updated)

        assertSame(updated, service.grant(admin, bearer, target, request))

        val order = inOrder(core, activities)
        order.verify(core).grantCredits(bearer, target, request)
        order.verify(activities).record(admin, "CREDIT_GRANT", "MEMBER", target, "500 · 이벤트 보상")
        verifyNoMoreInteractions(activities)
    }

    @Test
    fun `revoke returns the updated balance untouched and records the member, the amount and the reason after Core succeeded`() {
        grantCredits(admin)
        val request = CreditAdjustRequest(BigDecimal(200), "오지급 회수")
        `when`(core.revokeCredits(bearer, target, request)).thenReturn(updated)

        assertSame(updated, service.revoke(admin, bearer, target, request))

        val order = inOrder(core, activities)
        order.verify(core).revokeCredits(bearer, target, request)
        order.verify(activities).record(admin, "CREDIT_REVOKE", "MEMBER", target, "200 · 오지급 회수")
        verifyNoMoreInteractions(activities)
    }

    @Test
    fun `an operator without credits permission or a stale grant without operator is denied before Core`() {
        grantCredits(staleGrant)
        val request = CreditAdjustRequest(BigDecimal(500), "이벤트 보상")
        for (member in listOf(operatorWithoutCredits, staleGrant)) {
            assertEquals(HttpStatus.FORBIDDEN, status { service.read(member, bearer, target) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.grant(member, bearer, target, request) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.revoke(member, bearer, target, request) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.balances(member, bearer, CreditBalancesRequest(listOf(target))) })
        }
        verifyNoInteractions(core, activities)
    }

    @Test
    fun `a Core failure or rejection reaches the caller untouched and leaves no activity`() {
        grantCredits(admin)
        val insufficient = CreditAdjustRequest(BigDecimal(999_999), "회수")
        val rejection = UpstreamRejection(HttpStatus.CONFLICT, "사용 가능한 크레딧이 부족합니다.", IllegalStateException("cause"), "CREDIT_INSUFFICIENT")
        `when`(core.revokeCredits(bearer, target, insufficient)).thenThrow(rejection)
        `when`(core.grantCredits(bearer, target, CreditAdjustRequest(BigDecimal(500), "지급"))).thenThrow(ResponseStatusException(HttpStatus.NOT_FOUND))
        `when`(core.credits(bearer, target)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))
        `when`(core.creditBalances(bearer, CreditBalancesRequest(listOf(target)))).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        assertSame(rejection, assertThrows(UpstreamRejection::class.java) { service.revoke(admin, bearer, target, insufficient) })
        assertEquals(HttpStatus.NOT_FOUND, status { service.grant(admin, bearer, target, CreditAdjustRequest(BigDecimal(500), "지급")) })
        assertEquals(HttpStatus.BAD_GATEWAY, status { service.read(admin, bearer, target) })
        assertEquals(HttpStatus.BAD_GATEWAY, status { service.balances(admin, bearer, CreditBalancesRequest(listOf(target))) })
        verifyNoInteractions(activities)
    }

    @Test
    fun `balances returns Core's rows untouched for an operator with credits permission and records nothing`() {
        grantCredits(admin)
        val request = CreditBalancesRequest(listOf(target))
        val rows = mapper.readTree("""[{"memberId":"${target}","total":1200}]""")
        `when`(core.creditBalances(bearer, request)).thenReturn(rows)

        assertSame(rows, service.balances(admin, bearer, request))
        verifyNoInteractions(activities)
    }
}
