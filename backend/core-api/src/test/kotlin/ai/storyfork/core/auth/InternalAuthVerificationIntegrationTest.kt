package ai.storyfork.core.auth

import ai.storyfork.core.auth.config.AuthSecurityConfig
import ai.storyfork.core.auth.config.InternalAuthSecurityConfig
import ai.storyfork.core.auth.controller.AuthVerificationController
import ai.storyfork.core.auth.controller.MemberAdminController
import ai.storyfork.core.auth.entity.AuthMember
import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.service.AuthVerificationService
import ai.storyfork.core.auth.service.MemberAdminService
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.mockito.Mockito.`when`
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.context.annotation.Import
import org.springframework.security.oauth2.jose.jws.MacAlgorithm
import org.springframework.security.oauth2.jwt.*
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import tools.jackson.databind.json.JsonMapper

@WebMvcTest(controllers=[AuthVerificationController::class,MemberAdminController::class],properties=[
    "AUTH_JWT_SECRET=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    "CONTENT_CORE_AUTH_TOKEN=ci-content-core-auth-only-0123456789abcdef",
    "OPERATIONS_SERVICE_TOKEN=ci-operations-service-only-0123456789abcdef",
])
@Import(AuthSecurityConfig::class,InternalAuthSecurityConfig::class,AuthVerificationService::class,MemberAdminService::class,
    InternalAuthVerificationIntegrationTest.Security::class)
class InternalAuthVerificationIntegrationTest {
    @org.springframework.boot.test.context.TestConfiguration(proxyBeanMethods=false)
    @org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
    class Security

    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var encoder: JwtEncoder
    private val credential="ci-content-core-auth-only-0123456789abcdef"
    @MockitoBean lateinit var members: MemberRepository
    private val operations="ci-operations-service-only-0123456789abcdef"
    private val member=UUID.fromString("12345678-1234-4234-8234-123456789abc")
    private val admin=UUID.fromString("5f0c2c7e-8a51-4d6b-9a39-1f4f2b6d0a01")
    private val restricted=UUID.randomUUID()

    @BeforeEach fun members() {
        `when`(members.findById(member)).thenReturn(Optional.of(AuthMember(member,"reader@example.test","hash","Reader")))
        `when`(members.findById(admin)).thenReturn(Optional.of(AuthMember(admin,"admin@example.test","hash","Admin",operator=true)))
        `when`(members.findById(restricted)).thenReturn(Optional.of(AuthMember(restricted,"r@example.test","hash","R",restricted=true)))
    }
    private fun bearer(subject: String=member.toString(),expired: Boolean=false): String {
        val now=Instant.now()
        val claims=JwtClaimsSet.builder().subject(subject).issuedAt(now.minusSeconds(60))
            .expiresAt(if(expired) now.minusSeconds(1) else now.plusSeconds(60)).build()
        return "Bearer "+encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(),claims)).tokenValue
    }

    @Test fun `user bearer never substitutes for the separate service credential`() {
        for(header in listOf(null,"wrong",bearer())) {
            val request=post("/internal/v1/auth/verify").header("Authorization",bearer())
            if(header!=null) request.header("X-Content-Service-Token",header)
            mvc.perform(request).andExpect(status().isForbidden())
        }
    }

    @Test fun `trusted service receives only a canonical UUID and still needs a valid user token`() {
        val response=mvc.perform(post("/internal/v1/auth/verify")
            .header("X-Content-Service-Token",credential).header("Authorization",bearer()))
            .andExpect(status().isOk()).andReturn().response
        val body=JsonMapper.builder().build().readTree(response.contentAsString)
        assertEquals(2,body.size())
        assertEquals(member.toString(),body.path("memberId").asText())
        assertEquals(false,body.path("operator").asBoolean())
        for(token in listOf(null,"Bearer invalid",bearer(expired=true),bearer("not-a-uuid"),bearer(UUID.randomUUID().toString()))) {
            val request=post("/internal/v1/auth/verify").header("X-Content-Service-Token",credential)
            if(token!=null) request.header("Authorization",token)
            mvc.perform(request).andExpect(status().isUnauthorized())
        }
    }

    @Test fun `internal allowlist is narrow and public mutation CSRF remains required`() {
        for(request in listOf(get("/internal/v1/auth/verify"),post("/internal/v1/unknown"))) {
            mvc.perform(request.header("X-Content-Service-Token",credential).header("Authorization",bearer()))
                .andExpect(status().isForbidden())
        }
        mvc.perform(post("/api/v1/auth/signup").header("Authorization",bearer()).contentType("application/json")
            .content("{}" )).andExpect(status().isForbidden())
        mvc.perform(get("/api/v1/works").header("Authorization",bearer())).andExpect(status().isForbidden())
    }

    @Test fun `operations token may verify and restricted members are refused`() {
        mvc.perform(post("/internal/v1/auth/verify").header("X-Operations-Service-Token",operations).header("Authorization",bearer(admin.toString())))
            .andExpect(status().isOk())
        mvc.perform(post("/internal/v1/auth/verify").header("X-Content-Service-Token",credential).header("Authorization",bearer(restricted.toString())))
            .andExpect(status().isUnauthorized())
    }

    @Test fun `member admin APIs need the operations token and an operator bearer`() {
        `when`(members.search(listOf(true,false),"%%",org.springframework.data.domain.PageRequest.of(0,200,
            org.springframework.data.domain.Sort.by(org.springframework.data.domain.Sort.Order.desc("createdAt"),
                org.springframework.data.domain.Sort.Order.asc("id"))))).thenReturn(emptyList())
        mvc.perform(get("/internal/v1/members").header("X-Content-Service-Token",credential).header("Authorization",bearer(admin.toString())))
            .andExpect(status().isForbidden())
        // 인코딩한 경로 변형은 회원 API에 닿기 전에 firewall이 400으로 거절한다.
        mvc.perform(get("/internal/v1/%6Dembers").header("X-Content-Service-Token",credential).header("Authorization",bearer(admin.toString())))
            .andExpect(status().isBadRequest())
        mvc.perform(get("/internal/v1/members").header("X-Operations-Service-Token",operations).header("Authorization",bearer()))
            .andExpect(status().isForbidden())
        mvc.perform(get("/internal/v1/members").header("X-Operations-Service-Token",operations))
            .andExpect(status().isUnauthorized())
        mvc.perform(get("/internal/v1/members").header("X-Operations-Service-Token",operations).header("Authorization",bearer(admin.toString())))
            .andExpect(status().isOk())
        mvc.perform(put("/internal/v1/members/$admin/restriction").header("X-Operations-Service-Token",operations)
            .header("Authorization",bearer(admin.toString()))).andExpect(status().isBadRequest())
        mvc.perform(put("/internal/v1/members/${UUID.randomUUID()}/restriction").header("X-Operations-Service-Token",operations)
            .header("Authorization",bearer(admin.toString()))).andExpect(status().isNotFound())
        mvc.perform(post("/internal/v1/members/admins").header("X-Operations-Service-Token",operations)
            .header("Authorization",bearer(admin.toString())).contentType("application/json").content("{}"))
            .andExpect(status().isBadRequest())
    }
}
