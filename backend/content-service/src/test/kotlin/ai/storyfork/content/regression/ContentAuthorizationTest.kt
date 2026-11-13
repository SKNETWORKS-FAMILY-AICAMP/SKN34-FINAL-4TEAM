package ai.storyfork.content.regression

import ai.storyfork.content.auth.config.ContentSecurityConfig
import ai.storyfork.content.auth.service.CoreAuthVerificationService
import ai.storyfork.content.context.controller.ManuscriptQaController
import ai.storyfork.content.context.service.ManuscriptQaService
import ai.storyfork.content.context.service.dto.ManuscriptQaRequest
import ai.storyfork.content.context.service.dto.ManuscriptQaResponse
import ai.storyfork.content.context.service.dto.QaCoverage
import ai.storyfork.content._common.config.WebCorsConfig
import ai.storyfork.content.work.controller.WorkController
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.episode.controller.EpisodeController
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode_version.controller.EpisodeVersionController
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.publication.controller.PublicationController
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.work.service.dto.WorkListResponse
import ai.storyfork.content.work.service.dto.UpdateWorkRequest
import ai.storyfork.content.work.service.dto.WorkResponse
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.context.annotation.Import
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.mockito.Mockito.*
import jakarta.servlet.http.Cookie
import java.time.Instant

@WebMvcTest(controllers=[WorkController::class,EpisodeController::class,EpisodeVersionController::class,PublicationController::class,ai.storyfork.content.context.controller.ContextController::class,ManuscriptQaController::class,ai.storyfork.content.plan.controller.StoryPlanController::class],properties=["app.cors.allowed-origin=http://localhost:5173","AUTH_JWT_SECRET=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="])
@Import(ContentSecurityConfig::class,WebCorsConfig::class,ai.storyfork.content._common.exception.ContentExceptionHandler::class,ContentAuthorizationTest.MvcSecurity::class)
class ContentAuthorizationTest {
    @org.springframework.boot.test.context.TestConfiguration(proxyBeanMethods=false)
    @org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
    class MvcSecurity

    private fun csrfValue(): String {
        val request=org.springframework.mock.web.MockHttpServletRequest()
        val response=org.springframework.mock.web.MockHttpServletResponse()
        val token=org.springframework.security.web.csrf.DefaultCsrfToken("X-CSRF-TOKEN","_csrf","test-csrf")
        org.springframework.security.web.csrf.XorCsrfTokenRequestAttributeHandler().handle(request,response) {token}
        return (request.getAttribute(org.springframework.security.web.csrf.CsrfToken::class.java.name) as org.springframework.security.web.csrf.CsrfToken).token
    }

    @Autowired lateinit var mvc: MockMvc
    @MockitoBean lateinit var verification: CoreAuthVerificationService
    private val verifiedUser=java.util.UUID.fromString("12345678-1234-4234-8234-123456789abc")
    @MockitoBean lateinit var works: WorkService
    @MockitoBean lateinit var workViews: ai.storyfork.content.work.service.WorkViewService
    @MockitoBean lateinit var episodes: EpisodeService
    @MockitoBean lateinit var versions: EpisodeVersionService
    @MockitoBean lateinit var publication: PublicationService
    @MockitoBean lateinit var context: ai.storyfork.content.context.service.ContextService
    @MockitoBean internal lateinit var manuscriptQa: ManuscriptQaService
    @MockitoBean lateinit var plans: ai.storyfork.content.plan.service.StoryPlanService
    private fun token(): String {
        `when`(verification.verify("Bearer opaque-user-token")).thenReturn(ai.storyfork.content.auth.client.VerifiedMemberResponse(verifiedUser))
        return "opaque-user-token"
    }
    private fun mutation(path: String) = post(path).cookie(Cookie("XSRF-TOKEN","test-csrf")).header("X-CSRF-TOKEN",csrfValue()).contentType("application/json")
    private fun workUpdate(body: String) = put("/api/v1/works/work-id").header("Authorization","Bearer "+token())
        .cookie(Cookie("XSRF-TOKEN","test-csrf")).header("X-CSRF-TOKEN",csrfValue()).contentType("application/json")
        .content(body)

    @Test fun `public manuscript qa requires membership and csrf while using reader scope`() {
        val path = "/api/v1/public/works/work-id/context/qa"
        val body = """{"episode":2,"episodeVersionId":"v2","question":"누가 왔나요?","consent":true}"""
        val request = ManuscriptQaRequest(2, "v2", "누가 왔나요?", true)
        mvc.perform(mutation(path).content(body)).andExpect(status().isUnauthorized())
        mvc.perform(post(path).header("Authorization", "Bearer " + token()).content(body)).andExpect(status().isForbidden())
        verifyNoInteractions(manuscriptQa)
        `when`(manuscriptQa.ask("work-id", null, request))
            .thenReturn(ManuscriptQaResponse("insufficient", emptyList(), emptyList(), emptyList(), QaCoverage(emptyList(), emptyList(), emptyList())))
        mvc.perform(mutation(path).header("Authorization", "Bearer " + token()).content(body)).andExpect(status().isOk())
        verify(manuscriptQa).ask("work-id", null, request)
    }

    @Test fun `browser demo identity and forged headers cannot authorize`() {
        mvc.perform(get("/api/v1/works").header("X-User-Id","me")).andExpect(status().isUnauthorized())
        verifyNoInteractions(works,episodes,versions,publication)
    }
    @Test fun `malformed bearer is not anonymous on public GET`() {
        for (header in listOf("Bearer", "Bearerbroken", "bEaReR\tbroken")) {
            `when`(verification.verify(header)).thenThrow(ai.storyfork.content.auth.client.exception.CoreAuthException(401,"UNAUTHORIZED","서버 인증이 필요합니다."))
            mvc.perform(get("/api/v1/public/works").header("Authorization",header)).andExpect(status().isUnauthorized())
            verify(verification).verify(header)
        }
        verifyNoInteractions(works)
    }
    @Test fun `public search and ranking are anonymous GETs that bind their query options`() {
        `when`(works.publicList("달빛","tag","view")).thenReturn(WorkListResponse(emptyList()))
        `when`(works.publicList(null,null,null)).thenReturn(WorkListResponse(emptyList()))
        `when`(works.ranking("rising")).thenReturn(WorkListResponse(emptyList()))
        mvc.perform(get("/api/v1/public/works").param("q","달빛").param("f","tag").param("sort","view")).andExpect(status().isOk())
        mvc.perform(get("/api/v1/public/works")).andExpect(status().isOk())
        mvc.perform(get("/api/v1/public/works/ranking").param("kind","rising")).andExpect(status().isOk())
        verify(works).publicList("달빛","tag","view")
        verify(works).publicList(null,null,null)
        verify(works).ranking("rising")
        verifyNoInteractions(workViews)
    }
    @Test fun `ranking is routed to its own handler and not to the public work detail`() {
        `when`(works.ranking("top")).thenReturn(WorkListResponse(emptyList()))
        mvc.perform(get("/api/v1/public/works/ranking").param("kind","top")).andExpect(status().isOk())
        verify(works).ranking("top")
        verify(works,never()).publicRead("ranking")
        mvc.perform(get("/api/v1/public/works/ranking")).andExpect(status().isBadRequest())
    }
    @Test fun `invalid search options keep the 422 detail contract`() {
        `when`(works.publicList(null,"body",null)).thenThrow(ai.storyfork.content._common.exception.ContentFailure(422,"f 값을 확인해 주세요."))
        `when`(works.ranking("daily")).thenThrow(ai.storyfork.content._common.exception.ContentFailure(422,"kind 값을 확인해 주세요."))
        mvc.perform(get("/api/v1/public/works").param("f","body")).andExpect(status().`is`(422))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.detail").value("f 값을 확인해 주세요."))
        mvc.perform(get("/api/v1/public/works/ranking").param("kind","daily")).andExpect(status().`is`(422))
    }
    @Test fun `page and size are bound as raw text so a non numeric value is a 422 and not a 400`() {
        `when`(works.publicList(null,null,"like","1","20")).thenReturn(WorkListResponse(emptyList()))
        `when`(works.publicList(null,null,null,"abc",null)).thenThrow(ai.storyfork.content._common.exception.ContentFailure(422,"page 값을 확인해 주세요."))
        mvc.perform(get("/api/v1/public/works").param("sort","like").param("page","1").param("size","20")).andExpect(status().isOk())
        verify(works).publicList(null,null,"like","1","20")
        mvc.perform(get("/api/v1/public/works").param("page","abc")).andExpect(status().`is`(422))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.detail").value("page 값을 확인해 주세요."))
    }
    @Test fun `episode view recording requires verified identity and csrf and answers 204`() {
        val path="/api/v1/works/work-id/episodes/1/views"
        mvc.perform(mutation(path)).andExpect(status().isUnauthorized())
        mvc.perform(post(path).header("Authorization","Bearer "+token())).andExpect(status().isForbidden())
        verifyNoInteractions(workViews)
        mvc.perform(mutation(path).header("Authorization","Bearer "+token()).header("X-User-Id","forged")).andExpect(status().isNoContent())
        verify(workViews).record("work-id",1,verifiedUser.toString())
    }
    @Test fun `episode view recording maps unpublished targets to 404`() {
        doThrow(ai.storyfork.content._common.exception.ContentFailure(404,"공개 회차를 찾을 수 없어요.")).`when`(workViews).record("work-id",2,verifiedUser.toString())
        mvc.perform(mutation("/api/v1/works/work-id/episodes/2/views").header("Authorization","Bearer "+token()))
            .andExpect(status().isNotFound()).andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.detail").value("공개 회차를 찾을 수 없어요."))
        mvc.perform(mutation("/api/v1/works/work-id/episodes/abc/views").header("Authorization","Bearer "+token())).andExpect(status().isBadRequest())
    }
    @Test fun `episode mutations require server authentication and validate input`() {
        val base="/api/v1/works/work-id/episodes"
        for(path in listOf(base,base+"/1/versions",base+"/1/restore",base+"/1/publish")) {
            mvc.perform(mutation(path).content("""{"title":"회차","body":"원고","revision":0,"versionId":"v1","rightsConfirmed":true}""")).andExpect(status().isUnauthorized())
        }
        mvc.perform(put(base+"/1/draft").cookie(Cookie("XSRF-TOKEN","test-csrf")).header("X-CSRF-TOKEN",csrfValue()).contentType("application/json").content("""{"title":"회차","body":"원고","revision":0}""")).andExpect(status().isUnauthorized())
        mvc.perform(get(base+"/1")).andExpect(status().isUnauthorized())
        mvc.perform(put(base+"/1/draft").header("Authorization","Bearer "+token()).cookie(Cookie("XSRF-TOKEN","test-csrf")).header("X-CSRF-TOKEN",csrfValue()).contentType("application/json").content("""{"title":"","body":"원고","revision":0}""")).andExpect(status().isUnprocessableEntity())
        verifyNoInteractions(works,episodes,versions,publication)
    }
    @Test fun `only authenticated principal determines owner`() {
        `when`(works.list(verifiedUser.toString())).thenReturn(WorkListResponse(emptyList()))
        mvc.perform(get("/api/v1/works").header("Authorization","Bearer "+token()).header("X-User-Id","forged")).andExpect(status().isOk())
        verify(works).list(verifiedUser.toString())
    }
    @Test fun `work update binds path body and verified principal`() {
        val body=UpdateWorkRequest("새 제목","새 소개",7)
        `when`(works.update("work-id",verifiedUser.toString(),body)).thenReturn(WorkResponse("work-id",body.title,body.summary,"private",false,false,null,emptyList(),null))
        mvc.perform(workUpdate("""{"title":"새 제목","summary":"새 소개","revision":7}""").header("X-User-Id","forged")).andExpect(status().isOk())
        verify(works).update("work-id",verifiedUser.toString(),body)
    }
    @Test fun `work update binds optional genres and hashtags and an empty array stays a value`() {
        val chosen=UpdateWorkRequest("새 제목","새 소개",7,listOf("판타지","SF"),listOf("회귀"))
        val cleared=UpdateWorkRequest("새 제목","새 소개",7,listOf("판타지"),emptyList())
        for(body in listOf(chosen,cleared)) {
            `when`(works.update("work-id",verifiedUser.toString(),body)).thenReturn(WorkResponse("work-id",body.title,body.summary,"private",false,false,null,emptyList(),null))
        }
        mvc.perform(workUpdate("""{"title":"새 제목","summary":"새 소개","revision":7,"genres":["판타지","SF"],"hashtags":["회귀"]}""")).andExpect(status().isOk())
        mvc.perform(workUpdate("""{"title":"새 제목","summary":"새 소개","revision":7,"genres":["판타지"],"hashtags":[]}""")).andExpect(status().isOk())
        verify(works).update("work-id",verifiedUser.toString(),chosen)
        verify(works).update("work-id",verifiedUser.toString(),cleared)
    }
    @Test fun `work update rejects invalid fields before calling service`() {
        for(body in listOf(
            """{"title":"   ","revision":0}""",
            """{"title":"${"가".repeat(121)}","revision":0}""",
            """{"title":"제목","summary":"${"가".repeat(2001)}","revision":0}""",
            """{"title":"제목","revision":-1}""",
        )) {
            mvc.perform(workUpdate(body)).andExpect(status().isUnprocessableEntity())
        }
        verifyNoInteractions(works)
    }
    @Test fun `work update rejects malformed revision and JSON`() {
        for(body in listOf("""{"title":"제목","revision":"invalid"}""","{broken")) {
            mvc.perform(workUpdate(body)).andExpect(status().isBadRequest())
        }
        verifyNoInteractions(works)
    }
    @Test fun `foreign origin cannot write even with principal`() {
        mvc.perform(mutation("/api/v1/works").header("Authorization","Bearer "+token()).header("Origin","https://evil.example").content("""{"title":"test"}""")).andExpect(status().isForbidden())
        verifyNoInteractions(works,episodes,versions,publication)
    }
    @Test fun `missing context episode and malformed JSON keep HTTP binding errors`() {
        mvc.perform(get("/api/v1/works/work-id/context").header("Authorization","Bearer "+token())).andExpect(status().isBadRequest())
        mvc.perform(get("/api/v1/works/work-id/context?episode=abc").header("Authorization","Bearer "+token())).andExpect(status().isBadRequest())
        mvc.perform(mutation("/api/v1/works").header("Authorization","Bearer "+token()).content("{broken")).andExpect(status().isBadRequest())
        verifyNoInteractions(works,context)
    }
    @Test fun `authenticated mutations still require csrf`() {
        mvc.perform(post("/api/v1/works").header("Authorization","Bearer "+token()).contentType("application/json").content("""{"title":"test"}""")).andExpect(status().isForbidden())
        verifyNoInteractions(works,episodes,versions,publication)
    }
    @Test fun `private plan API requires verified identity and csrf`() {
        val path="/api/v1/works/work-id/story-plans"
        mvc.perform(get(path).header("X-User-Id","me")).andExpect(status().isUnauthorized())
        mvc.perform(mutation(path).content("""{"kind":"plot","title":"계획"}""")).andExpect(status().isUnauthorized())
        mvc.perform(post(path).header("Authorization","Bearer "+token()).contentType("application/json").content("""{"kind":"plot","title":"계획"}""")).andExpect(status().isForbidden())
        verifyNoInteractions(plans)
        `when`(plans.list("work-id",verifiedUser.toString())).thenReturn(ai.storyfork.content.plan.service.dto.StoryPlanListResponse(emptyList()))
        mvc.perform(get(path).header("Authorization","Bearer "+token()).header("X-User-Id","forged")).andExpect(status().isOk())
        verify(plans).list("work-id",verifiedUser.toString())
    }
    @Test fun `plan failures preserve conflict not found and validation detail responses`() {
        doThrow(ai.storyfork.content._common.exception.ContentFailure(409,"하위 장면 계획을 먼저 삭제해 주세요.")).`when`(plans).delete("work-id",verifiedUser.toString(),"plan-id",1)
        mvc.perform(delete("/api/v1/works/work-id/story-plans/plan-id?revision=1")
            .header("Authorization","Bearer "+token()).cookie(Cookie("XSRF-TOKEN","test-csrf"))
            .header("X-CSRF-TOKEN",csrfValue()))
            .andExpect(status().isConflict()).andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.detail").value("하위 장면 계획을 먼저 삭제해 주세요."))
        doThrow(ai.storyfork.content._common.exception.ContentFailure(404,"계획을 찾을 수 없어요.")).`when`(plans).read("work-id",verifiedUser.toString(),"missing")
        mvc.perform(get("/api/v1/works/work-id/story-plans/missing").header("Authorization","Bearer "+token()))
            .andExpect(status().isNotFound()).andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.detail").value("계획을 찾을 수 없어요."))
        mvc.perform(mutation("/api/v1/works/work-id/story-plans").header("Authorization","Bearer "+token()).content("""{"kind":"plot","title":""}"""))
            .andExpect(status().`is`(422)).andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.detail").exists())
    }
}
