package ai.storyfork.content.proposal

import ai.storyfork.content._common.config.WebCorsConfig
import ai.storyfork.content._common.exception.ContentExceptionHandler
import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.config.ContentSecurityConfig
import ai.storyfork.content.auth.service.CoreAuthVerificationService
import ai.storyfork.content.proposal.controller.AiRunController
import ai.storyfork.content.proposal.service.*
import ai.storyfork.content.proposal.service.dto.*
import org.junit.jupiter.api.Assertions.*
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

/** 실제 SSE writer·MVC 재접속 계약. AI·DB·브라우저는 사용하지 않는다. */
@WebMvcTest(controllers=[AiRunController::class],properties=["app.cors.allowed-origin=http://localhost:5173"])
@Import(ContentSecurityConfig::class,WebCorsConfig::class,ContentExceptionHandler::class,AiRunStreamService::class,AiRunHttpIntegrationTest.Security::class)
class AiRunStreamIntegrationTest {
    @Autowired lateinit var mvc: MockMvc
    @MockitoBean lateinit var verification: CoreAuthVerificationService
    @MockitoBean lateinit var runs: AiRunService

    @Test fun `wire events replay after last id without creating or polling another run`() {
        val owner=UUID.randomUUID();val url="/api/v1/works/w/ai/runs/run1/events"
        `when`(verification.verify("Bearer fixture-user")).thenReturn(owner)
        val first=AiRunEventResponse("run1",1,"run",1,"run",1,"ANALYZING","pending","요청을 분석하고 있습니다.")
        val last=first.copy(seq=2,step=4,code="FAILED",status="failed",message="작업을 완료하지 못했습니다.")
        `when`(runs.events("w",owner.toString(),"run1",null,null)).thenReturn(AiRunEventsResponse("run1",listOf(first,last),2,"failed"))
        `when`(runs.events("w",owner.toString(),"run1","1",null)).thenReturn(AiRunEventsResponse("run1",listOf(last),2,"failed"))
        fun connect(id: String?): String {
            val request=get(url).header("Authorization","Bearer fixture-user")
            if(id!=null) request.header("Last-Event-ID",id)
            val pending=mvc.perform(request).andExpect(request().asyncStarted()).andReturn()
            pending.getAsyncResult(3000)
            return mvc.perform(asyncDispatch(pending)).andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith("text/event-stream")).andReturn().response.contentAsString
        }
        val initial=connect(null);val replay=connect("1")
        assertTrue(initial.contains("id:1"));assertTrue(initial.contains("id:2"))
        assertFalse(replay.contains("id:1"));assertTrue(replay.contains("id:2"))
        assertTrue(replay.contains("event:progress"));assertFalse(replay.contains("grant"))
        verify(runs).events("w",owner.toString(),"run1",null,null)
        verify(runs).events("w",owner.toString(),"run1","1",null)
        verifyNoMoreInteractions(runs)
    }

    @Test fun `different member cannot reconnect to an owned run`() {
        val other=UUID.randomUUID()
        `when`(verification.verify("Bearer other-user")).thenReturn(other)
        doThrow(ContentFailure(404,"없음")).`when`(runs).events("w",other.toString(),"run1","1",null)
        mvc.perform(get("/api/v1/works/w/ai/runs/run1/events").header("Authorization","Bearer other-user").header("Last-Event-ID","1"))
            .andExpect(status().isNotFound())
    }
}
