package ai.storyfork.core.auth

import ai.storyfork.core.auth.config.AuthSecurityConfig
import ai.storyfork.core.auth.config.InternalAuthSecurityConfig
import ai.storyfork.core.auth.controller.AuthVerificationController
import ai.storyfork.core.auth.controller.MemberAdminController
import ai.storyfork.core.auth.controller.MemberNicknameController
import ai.storyfork.core.auth.entity.AuthMember
import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.service.AuthVerificationService
import ai.storyfork.core.auth.service.MemberAdminService
import ai.storyfork.core.auth.service.MemberNicknameService
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.anyIterable
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

@WebMvcTest(controllers=[AuthVerificationController::class,MemberAdminController::class,MemberNicknameController::class],properties=[
    "AUTH_JWT_SECRET=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    "CONTENT_CORE_AUTH_TOKEN=ci-content-core-auth-only-0123456789abcdef",
    "OPERATIONS_SERVICE_TOKEN=ci-operations-service-only-0123456789abcdef",
])
@Import(AuthSecurityConfig::class,InternalAuthSecurityConfig::class,AuthVerificationService::class,MemberAdminService::class,
    MemberNicknameService::class,InternalAuthVerificationIntegrationTest.Security::class)
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

    @Test fun `scheduled verification checks current member status with service credentials only`() {
        fun request(id: UUID) = post("/internal/v1/auth/verify-scheduled-member").contentType("application/json")
            .content("""{"memberId":"$id"}""")
        mvc.perform(request(member)).andExpect(status().isForbidden())
        mvc.perform(request(member).header("X-Content-Service-Token",credential)).andExpect(status().isOk())
        mvc.perform(request(restricted).header("X-Content-Service-Token",credential)).andExpect(status().isUnauthorized())
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

    private fun nicknames(ids: String)=post("/internal/v1/members/nicknames").contentType("application/json").content("""{"ids":$ids}""")

    @Test fun `content service token alone reads nicknames without a user bearer and skips unknown members`() {
        val unknown=UUID.randomUUID()
        `when`(members.findAllById(anyIterable<UUID>())).thenAnswer {call ->
            val wanted=call.getArgument<Iterable<UUID>>(0).toSet()
            listOf(AuthMember(member,"reader@example.test","hash","Reader"),AuthMember(restricted,"r@example.test","hash","R",restricted=true))
                .filter {it.id in wanted}
        }
        for(token in listOf(credential,operations)) {
            val header=if(token==credential) "X-Content-Service-Token" else "X-Operations-Service-Token"
            val response=mvc.perform(nicknames("""["$member","$restricted","$unknown","$member"]""").header(header,token))
                .andExpect(status().isOk()).andReturn().response
            val body=JsonMapper.builder().build().readTree(response.contentAsString)
            assertEquals(1,body.size())
            assertEquals(2,body.path("nicknames").size())
            assertEquals("Reader",body.path("nicknames").path(member.toString()).asString())
            // 이용 제한 회원의 닉네임도 반환하고 없는 회원은 키가 없다.
            assertEquals("R",body.path("nicknames").path(restricted.toString()).asString())
            assertTrue(body.path("nicknames").path(unknown.toString()).isMissingNode)
        }
    }

    @Test fun `nickname lookup refuses a missing or wrong service credential and does not widen other internal APIs`() {
        for(header in listOf<String?>(null,"wrong",bearer())) {
            val request=nicknames("[]").header("Authorization",bearer())
            if(header!=null) request.header("X-Content-Service-Token",header)
            mvc.perform(request).andExpect(status().isForbidden())
        }
        // Content 토큰은 정확한 경로만 허용하므로 끝 슬래시 변형은 운영 토큰이 없으면 거절한다.
        mvc.perform(post("/internal/v1/members/nicknames/").header("X-Content-Service-Token",credential).contentType("application/json")
            .content("""{"ids":[]}""")).andExpect(status().isForbidden())
        // 닉네임 조회를 열어도 다른 회원 API는 Content 토큰을 받지 않는다.
        mvc.perform(post("/internal/v1/members/admins").header("X-Content-Service-Token",credential).header("Authorization",bearer(admin.toString()))
            .contentType("application/json").content("{}")).andExpect(status().isForbidden())
    }

    @Test fun `nickname lookup rejects invalid UUIDs and more than 200 ids with 400`() {
        val tooMany=List(201) {"\"${UUID.randomUUID()}\""}.joinToString(",","[","]")
        for(ids in listOf("""["not-a-uuid"]""","""[null]""",tooMany)) {
            mvc.perform(nicknames(ids).header("X-Content-Service-Token",credential)).andExpect(status().isBadRequest())
        }
    }
}
