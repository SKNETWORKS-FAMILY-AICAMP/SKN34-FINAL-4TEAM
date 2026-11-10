package ai.storyfork.content.proposal

import ai.storyfork.content._common.config.WebCorsConfig
import ai.storyfork.content._common.exception.*
import ai.storyfork.content.auth.config.ContentSecurityConfig
import ai.storyfork.content.auth.service.CoreAuthVerificationService
import ai.storyfork.content.fixture.CsrfFixture
import ai.storyfork.content.proposal.controller.ChangeProposalController
import ai.storyfork.content.proposal.service.ChangeProposalService
import ai.storyfork.content.proposal.service.dto.*
import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.context.annotation.Import
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.*
import java.util.UUID

/** CI에서 기존 Bearer·CSRF 필터와 신규 결정·영수증 HTTP DTO를 검사한다. */
@WebMvcTest(controllers=[ChangeProposalController::class],properties=["app.cors.allowed-origin=http://localhost:5173"])
@Import(ContentSecurityConfig::class,WebCorsConfig::class,ContentExceptionHandler::class,ChangeProposalHttpIntegrationTest.Security::class)
class ChangeProposalHttpIntegrationTest {
    @org.springframework.boot.test.context.TestConfiguration(proxyBeanMethods=false)
    @org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
    class Security
    @Autowired lateinit var mvc: MockMvc
    @MockitoBean lateinit var verification: CoreAuthVerificationService
    @MockitoBean lateinit var service: ChangeProposalService
    private val owner=UUID.fromString("12345678-1234-4234-8234-123456789abc")
    private val path="/api/v1/works/w/change-proposals/p"
    private val hash="a".repeat(64)
    private val data=ChangeDecisionRequest(1,hash,"approved")
    private val body="""{"proposalVersion":1,"proposalHash":"$hash","decision":"approved"}"""
    private val receipt=ChangeReceipt("d","p",1,hash,owner.toString(),"approved","app","applied",
        listOf(ChangeResultVersion("e",0,1,"v")),"2026-11-10T00:00:00Z")
    private fun decide()=post("$path/decisions").header("Authorization","Bearer fixture-user")
        .cookie(Cookie("XSRF-TOKEN",CsrfFixture.raw)).header("X-CSRF-TOKEN",CsrfFixture.token())
        .header("Idempotency-Key","key").contentType("application/json").content(body)
    @BeforeEach fun authenticate() {
        `when`(verification.verify("Bearer fixture-user")).thenReturn(owner)
    }
    @Test fun `anonymous reads and csrf missing decisions never reach service`() {
        mvc.perform(get(path)).andExpect(status().isUnauthorized())
        mvc.perform(get("$path/versions/1/receipt")).andExpect(status().isUnauthorized())
        mvc.perform(post("$path/decisions").header("Authorization","Bearer fixture-user")
            .contentType("application/json").content(body)).andExpect(status().isForbidden())
        verifyNoInteractions(service)
    }
    @Test fun `decision forwards verified actor and key and returns committed revisions`() {
        `when`(service.decide("w","p",owner.toString(),"key",data)).thenReturn(receipt)
        mvc.perform(decide()).andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("applied"))
            .andExpect(jsonPath("$.resultVersions[0].before").value(0)).andExpect(jsonPath("$.resultVersions[0].after").value(1))
        verify(service).decide("w","p",owner.toString(),"key",data)
    }
    @Test fun `conflict refusal and storage failure preserve HTTP failure status`() {
        for(code in listOf(404,409,422,503)) {
            doThrow(ContentFailure(code,"안전한 오류")).`when`(service).decide("w","p",owner.toString(),"key",data)
            mvc.perform(decide()).andExpect(status().`is`(code)).andExpect(jsonPath("$.detail").value("안전한 오류"))
        }
    }
    @Test fun `receipt lookup returns the same actor scoped committed result`() {
        `when`(service.receipt("w",owner.toString(),"p",1)).thenReturn(receipt)
        mvc.perform(get("$path/versions/1/receipt").header("Authorization","Bearer fixture-user"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.decisionId").value("d"))
        verify(service).receipt("w",owner.toString(),"p",1)
    }
}
