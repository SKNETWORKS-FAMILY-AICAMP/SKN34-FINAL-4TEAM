package ai.storyfork.core.credit

import ai.storyfork.core.auth.config.AuthSecurityConfig
import ai.storyfork.core.auth.config.InternalAuthSecurityConfig
import ai.storyfork.core.auth.entity.AuthMember
import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.service.AuthVerificationService
import ai.storyfork.core.credit.controller.CreditAdminController
import ai.storyfork.core.credit.domain.CreditKind
import ai.storyfork.core.credit.domain.InsufficientCreditException
import ai.storyfork.core.credit.service.CreditAdminService
import ai.storyfork.core.credit.service.CreditService
import ai.storyfork.core.credit.service.dto.CreditBalanceItem
import ai.storyfork.core.credit.service.dto.CreditBalanceResponse
import ai.storyfork.core.credit.service.dto.CreditHistoryItem
import ai.storyfork.core.credit.service.dto.CreditHistoryResponse
import java.math.BigDecimal
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.doThrow
import org.mockito.Mockito.verify
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.context.annotation.Import
import org.springframework.http.HttpHeaders
import org.springframework.security.oauth2.jose.jws.MacAlgorithm
import org.springframework.security.oauth2.jwt.JwsHeader
import org.springframework.security.oauth2.jwt.JwtClaimsSet
import org.springframework.security.oauth2.jwt.JwtEncoder
import org.springframework.security.oauth2.jwt.JwtEncoderParameters
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

/**
 * 운영 서비스가 부르는 회원 크레딧 내부 API(DEC-57)의 경로·인증·JSON·오류 상태를 확인한다.
 * 크레딧 서비스는 대역이고 권한·검증 규칙은 CreditAdminService 실제 구현이다. 장부 규칙은 CreditRevokeTest·CreditIntegrationTest가 맡는다.
 */
@WebMvcTest(controllers = [CreditAdminController::class], properties = [
    "AUTH_JWT_SECRET=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    "CONTENT_CORE_AUTH_TOKEN=ci-content-core-auth-only-0123456789abcdef",
    "OPERATIONS_SERVICE_TOKEN=ci-operations-service-only-0123456789abcdef",
])
@Import(AuthSecurityConfig::class, InternalAuthSecurityConfig::class, AuthVerificationService::class, CreditAdminService::class,
    CreditAdminApiIntegrationTest.Security::class)
class CreditAdminApiIntegrationTest {
    @org.springframework.boot.test.context.TestConfiguration(proxyBeanMethods = false)
    @org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
    class Security

    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var encoder: JwtEncoder
    @MockitoBean lateinit var members: MemberRepository
    @MockitoBean lateinit var credits: CreditService
    private val contentToken = "ci-content-core-auth-only-0123456789abcdef"
    private val operationsToken = "ci-operations-service-only-0123456789abcdef"
    private val operator = UUID.fromString("5f0c2c7e-8a51-4d6b-9a39-1f4f2b6d0a01")
    private val reader = UUID.fromString("12345678-1234-4234-8234-123456789abc")
    private val target = UUID.fromString("0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d")
    private val base = "/internal/v1/credits/members/$target"
    private val balances = "/internal/v1/credits/balances"
    private val adjust = """{"amount":40,"reason":"이벤트 보상"}"""
    private val balance = CreditBalanceResponse(BigDecimal("40"), listOf(CreditBalanceItem("operator", BigDecimal("40"), Instant.parse("2026-11-30T15:00:00Z"))))

    /** Kotlin 비 null 인자에 Mockito 매처의 null이 들어가지 않게 원래 값을 돌려준다. */
    private fun <T : Any> eq(value: T): T = ArgumentMatchers.eq(value) ?: value
    private fun anyTime(): Instant = ArgumentMatchers.any(Instant::class.java) ?: Instant.EPOCH

    private fun bearer(subject: UUID): String {
        val now = Instant.now()
        val claims = JwtClaimsSet.builder().subject(subject.toString()).issuedAt(now.minusSeconds(60)).expiresAt(now.plusSeconds(60)).build()
        return "Bearer " + encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).tokenValue
    }

    /** 기본은 운영 서비스 토큰과 operator Bearer. 서비스 토큰·Bearer·헤더 이름을 바꿔 거절 경로를 만든다. */
    private fun headers(subject: UUID? = operator, token: String? = operationsToken, header: String = "X-Operations-Service-Token") =
        HttpHeaders().apply {
            if (token != null) set(header, token)
            if (subject != null) set("Authorization", bearer(subject))
        }

    @BeforeEach
    fun stubs() {
        `when`(members.findById(operator)).thenReturn(Optional.of(AuthMember(operator, "admin@example.test", "hash", "Admin", operator = true)))
        `when`(members.findById(reader)).thenReturn(Optional.of(AuthMember(reader, "reader@example.test", "hash", "Reader")))
        `when`(members.existsById(target)).thenReturn(true)
        `when`(credits.balance(eq(target), anyTime())).thenReturn(balance)
        `when`(credits.history(target)).thenReturn(CreditHistoryResponse(listOf(CreditHistoryItem("revoke", "operator", BigDecimal("5"), Instant.parse("2026-11-10T01:00:00Z")))))
    }

    @Test
    fun `운영 서비스 토큰과 operator Bearer가 모두 있어야 열리고 열어 둔 경로만 받는다`() {
        // Content 토큰은 operator Bearer가 있어도 받지 않는다.
        mvc.perform(get(base).headers(headers(token = contentToken, header = "X-Content-Service-Token"))).andExpect(status().isForbidden())
        mvc.perform(get(base).headers(headers(token = null))).andExpect(status().isForbidden())
        mvc.perform(get(base).headers(headers(subject = null))).andExpect(status().isUnauthorized())
        mvc.perform(get(base).headers(headers(subject = reader))).andExpect(status().isForbidden())
        for (path in listOf("$base/grants", "$base/revocations")) {
            mvc.perform(post(path).headers(headers(token = contentToken, header = "X-Content-Service-Token")).contentType("application/json").content(adjust))
                .andExpect(status().isForbidden())
            mvc.perform(post(path).headers(headers(subject = reader)).contentType("application/json").content(adjust)).andExpect(status().isForbidden())
        }
        mvc.perform(delete(base).headers(headers())).andExpect(status().isForbidden())
        mvc.perform(get("$base/grants").headers(headers())).andExpect(status().isForbidden())
        // 묶음 잔액도 같다: Content 토큰·Bearer 없음·일반 회원은 열리지 않는다.
        val ids = """{"memberIds":["$target"]}"""
        mvc.perform(post(balances).headers(headers(token = contentToken, header = "X-Content-Service-Token")).contentType("application/json").content(ids))
            .andExpect(status().isForbidden())
        mvc.perform(post(balances).headers(headers(subject = null)).contentType("application/json").content(ids)).andExpect(status().isUnauthorized())
        mvc.perform(post(balances).headers(headers(subject = reader)).contentType("application/json").content(ids)).andExpect(status().isForbidden())
        verifyNoInteractions(credits)
    }

    @Test
    fun `조회는 잔액과 내역을 한 응답에 담고 없는 회원은 404다`() {
        mvc.perform(get(base).headers(headers())).andExpect(status().isOk())
            .andExpect(jsonPath("$.balance.total").value(40))
            .andExpect(jsonPath("$.balance.items[0].kind").value("operator"))
            .andExpect(jsonPath("$.balance.items[0].expiresAt").value("2026-11-30T15:00:00Z"))
            .andExpect(jsonPath("$.history.items[0].type").value("revoke"))
            .andExpect(jsonPath("$.history.items[0].kind").value("operator"))
        mvc.perform(get("/internal/v1/credits/members/${UUID.randomUUID()}").headers(headers())).andExpect(status().isNotFound())
    }

    @Test
    fun `지급·회수는 201과 갱신된 잔액을 돌려준다`() {
        mvc.perform(post("$base/grants").headers(headers()).contentType("application/json").content(adjust)).andExpect(status().isCreated())
            .andExpect(jsonPath("$.total").value(40)).andExpect(jsonPath("$.items[0].kind").value("operator"))
        verify(credits).grant(eq(target), eq(CreditKind.OPERATOR), eq(BigDecimal("40")), anyTime())

        mvc.perform(post("$base/revocations").headers(headers()).contentType("application/json").content("""{"amount":15,"reason":"오지급 회수"}"""))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.total").value(40))
        verify(credits).revoke(eq(target), eq(BigDecimal("15")), anyTime())
    }

    @Test
    fun `묶음 잔액은 찾은 회원의 합계만 돌려주고 100명을 넘으면 422다`() {
        val ghost = UUID.randomUUID()
        `when`(members.findAllById(listOf(target, ghost))).thenReturn(listOf(AuthMember(target, "target@example.test", "hash", "Target")))
        mvc.perform(post(balances).headers(headers()).contentType("application/json").content("""{"memberIds":["$target","$ghost"]}"""))
            .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].memberId").value(target.toString())).andExpect(jsonPath("$[0].total").value(40))

        val tooMany = List(101) { "\"${UUID.randomUUID()}\"" }.joinToString(",")
        mvc.perform(post(balances).headers(headers()).contentType("application/json").content("""{"memberIds":[$tooMany]}"""))
            .andExpect(status().`is`(422)).andExpect(jsonPath("$.code").value("INVALID_CREDIT_REQUEST"))
        // 잘못된 UUID는 본문을 읽지 못해 규칙 위반(422)이 아니라 400이다.
        mvc.perform(post(balances).headers(headers()).contentType("application/json").content("""{"memberIds":["abc"]}""")).andExpect(status().isBadRequest())
    }

    @Test
    fun `잔액 초과는 409, 규칙 위반은 422, 없는 회원은 404, 깨진 본문은 400이다`() {
        doThrow(InsufficientCreditException(BigDecimal("500"), BigDecimal("3"))).`when`(credits).revoke(eq(target), eq(BigDecimal("500")), anyTime())
        mvc.perform(post("$base/revocations").headers(headers()).contentType("application/json").content("""{"amount":500,"reason":"회수"}"""))
            .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("CREDIT_INSUFFICIENT"))

        // 규칙 자체는 CreditAdminServiceTest가 확인하고, 여기서는 소수 금액과 빠진 필드가 JSON 바인딩을 지나 422가 되는지만 본다.
        for (body in listOf("""{"amount":1.5,"reason":"x"}""", """{"reason":"x"}""")) {
            mvc.perform(post("$base/grants").headers(headers()).contentType("application/json").content(body))
                .andExpect(status().`is`(422)).andExpect(jsonPath("$.code").value("INVALID_CREDIT_REQUEST"))
        }
        mvc.perform(post("/internal/v1/credits/members/${UUID.randomUUID()}/grants").headers(headers()).contentType("application/json").content(adjust))
            .andExpect(status().isNotFound())
        for (body in listOf("""{"amount":"abc","reason":"x"}""", "")) {
            mvc.perform(post("$base/grants").headers(headers()).contentType("application/json").content(body)).andExpect(status().isBadRequest())
        }
        // 경로의 잘못된 UUID는 규칙 위반(422)이 아니라 400이다.
        mvc.perform(get("/internal/v1/credits/members/not-a-uuid").headers(headers())).andExpect(status().isBadRequest())
    }
}
