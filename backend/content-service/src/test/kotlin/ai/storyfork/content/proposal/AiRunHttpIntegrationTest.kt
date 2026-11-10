package ai.storyfork.content.proposal

import ai.storyfork.content._common.config.WebCorsConfig
import ai.storyfork.content._common.exception.*
import ai.storyfork.content.auth.config.ContentSecurityConfig
import ai.storyfork.content.auth.service.CoreAuthVerificationService
import ai.storyfork.content.fixture.CsrfFixture
import ai.storyfork.content.proposal.controller.AiRunController
import ai.storyfork.content.proposal.controller.AiRunGrantController
import ai.storyfork.content.proposal.controller.ProposalController
import ai.storyfork.content.proposal.service.AiRunService
import ai.storyfork.content.proposal.service.AiRunStreamService
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

/** 실제 보안 필터·MVC 계약만 검증한다. 업무 멱등성은 단위/격리 DB 테스트에서 검증한다. */
@WebMvcTest(controllers=[AiRunController::class,AiRunGrantController::class,ProposalController::class],properties=["app.cors.allowed-origin=http://localhost:5173","INTERNAL_TOKEN=fixture-service-token-at-least-32-characters"])
@Import(ContentSecurityConfig::class,WebCorsConfig::class,ContentExceptionHandler::class,AiRunHttpIntegrationTest.Security::class)
class AiRunHttpIntegrationTest {
    @org.springframework.boot.test.context.TestConfiguration(proxyBeanMethods=false)
    @org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
    class Security

    @Autowired lateinit var mvc: MockMvc
    @MockitoBean lateinit var verification: CoreAuthVerificationService
    @MockitoBean lateinit var service: AiRunService
    @MockitoBean lateinit var stream: AiRunStreamService
    @MockitoBean lateinit var proposals: ai.storyfork.content.proposal.service.ProposalService
    private val owner=UUID.fromString("12345678-1234-4234-8234-123456789abc")
    private val path="/api/v1/works/w/ai"
    private val body="""{"operation":"ask","prompt":"질문","target":{"basisEpisode":1,"baseRevision":0},"options":{"modelConsent":{"providers":["openai"],"purpose":"ask","maxCalls":1,"noticeVersion":"v1"}}}"""
    private val data=AiRunRequest(operation="ask",prompt="질문",target=AiRunTarget(1,baseRevision=0),
        options=AiRunOptions(ModelConsent(listOf("openai"),"ask",1,"v1")))
    private fun postRun()=post("$path/runs").header("Authorization","Bearer fixture-user")
        .cookie(Cookie("XSRF-TOKEN",CsrfFixture.raw)).header("X-CSRF-TOKEN",CsrfFixture.token())
        .header("Idempotency-Key","key").contentType("application/json").content(body)

    @BeforeEach fun authenticate() {
        `when`(verification.verify("Bearer fixture-user")).thenReturn(owner)
    }

    @Test fun `anonymous GET is 401 and authenticated POST without csrf is 403`() {
        mvc.perform(get("$path/runs/run1")).andExpect(status().isUnauthorized())
        mvc.perform(get("$path/threads/thread1")).andExpect(status().isUnauthorized())
        mvc.perform(post("$path/runs").cookie(Cookie("XSRF-TOKEN",CsrfFixture.raw)).header("X-CSRF-TOKEN",CsrfFixture.token())
            .contentType("application/json").content(body)).andExpect(status().isUnauthorized())
        mvc.perform(post("$path/runs").header("Authorization","Bearer fixture-user")
            .contentType("application/json").content(body)).andExpect(status().isForbidden())
        verifyNoInteractions(service)
    }

    @Test fun `authenticated csrf request forwards only verified principal and key`() {
        `when`(service.create("w",owner.toString(),"key",data)).thenReturn(
            AiRunResponse("run1","thread1","w","failed","blocked",AiRunErrorResponse("AI_RUN_UNCONFIGURED")))
        mvc.perform(postRun()).andExpect(status().isAccepted())
            .andExpect(jsonPath("$.runId").value("run1")).andExpect(jsonPath("$.status").value("failed"))
            .andExpect(jsonPath("$.error.code").value("AI_RUN_UNCONFIGURED"))
        verify(service).create("w",owner.toString(),"key",data)
    }

    @Test fun `hidden resource conflict and scope failures retain their HTTP codes`() {
        for (code in listOf(404,409,422)) {
            doThrow(ContentFailure(code,"안전한 오류")).`when`(service).create("w",owner.toString(),"key",data)
            mvc.perform(postRun()).andExpect(status().`is`(code)).andExpect(jsonPath("$.detail").value("안전한 오류"))
        }
    }

    @Test fun `run and thread GET require ownership again and do not dispatch`() {
        `when`(service.read("w",owner.toString(),"run1")).thenThrow(ContentFailure(404,"없음"))
        `when`(service.thread("w",owner.toString(),"thread1",0,20)).thenReturn(AiThreadResponse("thread1","w",null,emptyList(),null))
        mvc.perform(get("$path/runs/run1").header("Authorization","Bearer fixture-user")).andExpect(status().isNotFound())
        mvc.perform(get("$path/threads/thread1").header("Authorization","Bearer fixture-user"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.runs").isEmpty())
        verify(service).read("w",owner.toString(),"run1")
        verify(service).thread("w",owner.toString(),"thread1",0,20)
        verifyNoMoreInteractions(service)
    }

    @Test fun `result endpoint reuses bearer authorization and returns explicit mock flag`() {
        `when`(service.result("w",owner.toString(),"run1")).thenReturn(AiRunResultResponse("partial","합성 결과",true,
            listOf(AiRunQuote("합성 인용",1)),AiRunCoverageResponse(3,1,listOf("missing"))))
        mvc.perform(get("$path/runs/run1/result")).andExpect(status().isUnauthorized())
        mvc.perform(get("$path/runs/run1/result").header("Authorization","Bearer fixture-user"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.isMock").value(true))
            .andExpect(jsonPath("$.coverage.verifiedCount").value(1)).andExpect(jsonPath("$.citations[0].quote").value("합성 인용"))
    }

    @Test fun `SSE preflight preserves expired cursor and safe response headers`() {
        doThrow(ContentFailure(410,"상태를 다시 조회해 주세요.")).`when`(stream).open("w",owner.toString(),"run1","1",null)
        mvc.perform(get("$path/runs/run1/events").header("Authorization","Bearer fixture-user").header("Last-Event-ID","1"))
            .andExpect(status().isGone())
        val emitter=org.springframework.web.servlet.mvc.method.annotation.SseEmitter(1000)
        `when`(stream.open("w",owner.toString(),"run1",null,"2")).thenReturn(emitter)
        val response=mvc.perform(get("$path/runs/run1/events").header("Authorization","Bearer fixture-user").param("cursor","2"))
            .andExpect(status().isOk()).andExpect(header().string("X-Accel-Buffering","no"))
            .andExpect(header().string("Cache-Control","no-store")).andReturn()
        emitter.complete()
        mvc.perform(asyncDispatch(response)).andExpect(status().isOk())
        verifyNoInteractions(service)
    }

    @Test fun `SSE requires bearer and cancel requires csrf then forwards verified owner`() {
        mvc.perform(get("$path/runs/run1/events")).andExpect(status().isUnauthorized())
        mvc.perform(post("$path/runs/run1/cancel").header("Authorization","Bearer fixture-user"))
            .andExpect(status().isForbidden())
        `when`(service.cancel("w",owner.toString(),"run1")).thenReturn(AiRunResponse("run1","thread1","w","cancelled","accepted"))
        mvc.perform(post("$path/runs/run1/cancel").header("Authorization","Bearer fixture-user")
            .cookie(Cookie("XSRF-TOKEN",CsrfFixture.raw)).header("X-CSRF-TOKEN",CsrfFixture.token()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("cancelled"))
    }

    @Test fun `internal grant verification has independent service auth and no public csrf exemption`() {
        val payload=dispatchFixture()
        val mapper=tools.jackson.module.kotlin.jacksonMapperBuilder().build()
        val bytes=mapper.writeValueAsBytes(payload)
        mvc.perform(post("/internal/v1/ai/runs/r/verify").contentType("application/json").content(bytes))
            .andExpect(status().isForbidden())
        `when`(service.verifyGrant("r",payload)).thenReturn(ai.storyfork.content.proposal.client.dto.AiRunGrantResponse(
            "r","t","scope",java.time.Instant.now().plusSeconds(300)))
        mvc.perform(post("/internal/v1/ai/runs/r/verify").header("X-Internal-Token","fixture-service-token-at-least-32-characters")
            .contentType("application/json").content(bytes)).andExpect(status().isOk())
            .andExpect(jsonPath("$.scopeRef").value("scope"))
    }

    @Test fun `scope validation never invokes the service and legacy proposal accept mappings remain`() {
        mvc.perform(postRun().content(body.replace("\"basisEpisode\":1","\"basisEpisode\":0")))
            .andExpect(status().isUnprocessableContent())
        verifyNoInteractions(service)
        val request=ProposalRequest(0,"계속",true)
        `when`(proposals.propose("w",owner.toString(),request)).thenThrow(ContentFailure(503,"미연결"))
        val existing=post("/api/v1/works/w/proposals").header("Authorization","Bearer fixture-user")
            .cookie(Cookie("XSRF-TOKEN",CsrfFixture.raw)).header("X-CSRF-TOKEN",CsrfFixture.token())
            .contentType("application/json").content("""{"revision":0,"prompt":"계속","consent":true}""")
        mvc.perform(existing).andExpect(status().isServiceUnavailable())
        `when`(proposals.accept("w","proposal",owner.toString(),0)).thenThrow(ContentFailure(409,"충돌"))
        mvc.perform(post("/api/v1/works/w/proposals/proposal/accept").header("Authorization","Bearer fixture-user")
            .cookie(Cookie("XSRF-TOKEN",CsrfFixture.raw)).header("X-CSRF-TOKEN",CsrfFixture.token())
            .contentType("application/json").content("""{"revision":0}""")).andExpect(status().isConflict())
    }
}
