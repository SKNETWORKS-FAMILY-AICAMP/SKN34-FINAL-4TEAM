package ai.storyfork.core.credit

import ai.storyfork.core.auth.config.AuthSecurityConfig
import ai.storyfork.core.auth.config.InternalAuthSecurityConfig
import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.service.AuthVerificationService
import ai.storyfork.core.credit.controller.InternalCreditController
import ai.storyfork.core.credit.domain.InsufficientCreditException
import ai.storyfork.core.credit.domain.ReservationClosedException
import ai.storyfork.core.credit.domain.ReservationNotFoundException
import ai.storyfork.core.credit.service.AiRateLimitDecision
import ai.storyfork.core.credit.service.AiRateLimitService
import ai.storyfork.core.credit.service.CreditReservationService
import ai.storyfork.core.credit.service.dto.CreditReservationResponse
import java.math.BigDecimal
import java.time.Duration
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.never
import org.mockito.Mockito.verify
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.context.annotation.Import
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

/** Content가 서비스 토큰으로 부르는 크레딧 예약·정산·해제와 속도 제한 내부 API의 HTTP·보안 경계를 확인한다. 서비스 동작은 대역이다. */
@WebMvcTest(controllers=[InternalCreditController::class],properties=[
    "AUTH_JWT_SECRET=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    "CONTENT_CORE_AUTH_TOKEN=ci-content-core-auth-only-0123456789abcdef",
    "OPERATIONS_SERVICE_TOKEN=ci-operations-service-only-0123456789abcdef",
])
@Import(AuthSecurityConfig::class,InternalAuthSecurityConfig::class,AuthVerificationService::class,InternalCreditApiIntegrationTest.Security::class)
class InternalCreditApiIntegrationTest {
    @org.springframework.boot.test.context.TestConfiguration(proxyBeanMethods=false)
    @org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
    class Security

    @Autowired lateinit var mvc: MockMvc
    @MockitoBean lateinit var members: MemberRepository
    @MockitoBean lateinit var reservations: CreditReservationService
    @MockitoBean lateinit var rateLimits: AiRateLimitService
    private val credential="ci-content-core-auth-only-0123456789abcdef"
    private val member=UUID.fromString("12345678-1234-4234-8234-123456789abc")
    private val paths=listOf("/internal/v1/credits/reservations","/internal/v1/credits/reservations/settle",
        "/internal/v1/credits/reservations/release","/internal/v1/ai-rate-limit/acquire")

    /** Kotlin 비 null 인자에 Mockito 매처의 null이 들어가지 않게 원래 값을 돌려준다. */
    private fun <T: Any> eq(value: T): T = ArgumentMatchers.eq(value) ?: value
    private fun anyTime(): Instant = ArgumentMatchers.any(Instant::class.java) ?: Instant.EPOCH
    private fun call(path: String, body: String)=post(path).header("X-Content-Service-Token",credential).contentType("application/json").content(body)
    private fun reservation(status: String, settled: BigDecimal?=null)=CreditReservationResponse(UUID.randomUUID(),"op-1",status,BigDecimal("10"),settled)

    @Test fun `서비스 토큰으로 예약하고 정산하고 해제한다`() {
        `when`(reservations.reserve(eq(member),eq(BigDecimal("10")),eq("op-1"),anyTime())).thenReturn(reservation("reserved"))
        `when`(reservations.settle(eq(member),eq("op-1"),eq(BigDecimal("2.5")),anyTime())).thenReturn(reservation("settled",BigDecimal("2.5")))
        `when`(reservations.release(eq(member),eq("op-2"),anyTime())).thenReturn(reservation("released"))

        mvc.perform(call(paths[0],"""{"memberId":"$member","operationKey":"op-1","amount":10}"""))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("reserved")).andExpect(jsonPath("$.reservedAmount").value(10))
        mvc.perform(call(paths[1],"""{"memberId":"$member","operationKey":"op-1","actual":2.5}"""))
            .andExpect(status().isOk()).andExpect(jsonPath("$.settledAmount").value(2.5))
        mvc.perform(call(paths[2],"""{"memberId":"$member","operationKey":"op-2"}"""))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("released"))
    }

    @Test fun `잔액 부족·없는 예약·닫힌 예약·규칙 위반을 구분되는 코드로 알린다`() {
        `when`(reservations.reserve(eq(member),eq(BigDecimal("10")),eq("op-1"),anyTime()))
            .thenThrow(InsufficientCreditException(BigDecimal("10"),BigDecimal("3")))
        `when`(reservations.settle(eq(member),eq("missing"),eq(BigDecimal.ONE),anyTime())).thenThrow(ReservationNotFoundException())
        `when`(reservations.release(eq(member),eq("settled"),anyTime())).thenThrow(ReservationClosedException("이미 정산한 예약은 해제할 수 없습니다."))
        `when`(reservations.reserve(eq(member),eq(BigDecimal("-1")),eq("op-1"),anyTime())).thenThrow(IllegalArgumentException("예약 크레딧은 0보다 커야 합니다."))

        mvc.perform(call(paths[0],"""{"memberId":"$member","operationKey":"op-1","amount":10}"""))
            .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("INSUFFICIENT_CREDIT"))
            // 잔액 숫자는 응답에 싣지 않는다.
            .andExpect(jsonPath("$.detail").value("사용 가능한 크레딧이 부족합니다."))
        mvc.perform(call(paths[1],"""{"memberId":"$member","operationKey":"missing","actual":1}"""))
            .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("RESERVATION_NOT_FOUND"))
        mvc.perform(call(paths[2],"""{"memberId":"$member","operationKey":"settled"}"""))
            .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("RESERVATION_CLOSED"))
        mvc.perform(call(paths[0],"""{"memberId":"$member","operationKey":"op-1","amount":-1}"""))
            .andExpect(status().`is`(422)).andExpect(jsonPath("$.code").value("INVALID_CREDIT_REQUEST"))
            .andExpect(jsonPath("$.detail").value("예약 크레딧은 0보다 커야 합니다."))
    }

    @Test fun `전용 예외가 아닌 IllegalStateException은 닫힌 예약 409로 바꾸지 않고 서버 오류로 남긴다`() {
        `when`(reservations.settle(eq(member),eq("broken"),eq(BigDecimal.ONE),anyTime())).thenThrow(IllegalStateException("예약해 둔 지급분이 정산 금액보다 적습니다."))
        // 처리하지 않은 예외라 MockMvc는 응답 대신 ServletException으로 그대로 올린다(실제 서버에서는 500).
        val error=assertThrows(jakarta.servlet.ServletException::class.java) {
            mvc.perform(call(paths[1],"""{"memberId":"$member","operationKey":"broken","actual":1}"""))
        }
        assertInstanceOf(IllegalStateException::class.java,error.cause)
    }

    @Test fun `속도 제한은 받으면 allowed, 아니면 다시 시도할 시간을 준다`() {
        `when`(rateLimits.tryAcquire(eq(member),eq(100),anyTime())).thenReturn(AiRateLimitDecision.Allowed)
        `when`(rateLimits.tryAcquire(eq(member),eq(200),anyTime())).thenReturn(AiRateLimitDecision.Limited(Duration.ofMillis(1500)))

        mvc.perform(call(paths[3],"""{"memberId":"$member","tokens":100}"""))
            .andExpect(status().isOk()).andExpect(jsonPath("$.allowed").value(true)).andExpect(jsonPath("$.retryAfterMillis").doesNotExist())
        mvc.perform(call(paths[3],"""{"memberId":"$member","tokens":200}"""))
            .andExpect(status().isOk()).andExpect(jsonPath("$.allowed").value(false)).andExpect(jsonPath("$.retryAfterMillis").value(1500))
    }

    @Test fun `서비스 토큰이 없거나 틀리면 403이고 서비스를 부르지 않는다`() {
        for(path in paths) for(token in listOf<String?>(null,"wrong")) {
            val request=post(path).contentType("application/json").content("""{"memberId":"$member","operationKey":"op","amount":1,"actual":1,"tokens":1}""")
            if(token!=null) request.header("X-Content-Service-Token",token)
            mvc.perform(request).andExpect(status().isForbidden())
        }
        // Content 토큰은 정확한 경로만 허용하므로 끝 슬래시 변형은 거절한다.
        mvc.perform(call(paths[0]+"/","""{"memberId":"$member","operationKey":"op","amount":1}""")).andExpect(status().isForbidden())
        verifyNoInteractions(reservations,rateLimits)
    }

    @Test fun `필수 값이 빠진 요청은 400이고 서비스를 부르지 않는다`() {
        mvc.perform(call(paths[0],"""{"memberId":"$member","amount":1}""")).andExpect(status().isBadRequest())
        mvc.perform(call(paths[3],"""{"memberId":"not-a-uuid","tokens":1}""")).andExpect(status().isBadRequest())
        verify(reservations,never()).reserve(eq(member),eq(BigDecimal.ONE),eq("op"),anyTime())
        verifyNoInteractions(rateLimits)
    }
}
