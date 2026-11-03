package ai.storyfork.core.content

import ai.storyfork.core.content.controller.ContentController
import ai.storyfork.core.content.service.ContentService
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.mockito.Mockito.*

@WebMvcTest(controllers=[ContentController::class], properties=["app.content.enabled=true","app.content.dev-owner="])
class ContentAuthorizationTest {
    @Autowired lateinit var mvc: MockMvc
    @MockitoBean lateinit var service: ContentService
    @Test fun `browser demo identity and forged headers cannot authorize`() {
        mvc.perform(get("/api/v1/works").header("X-User-Id","me")).andExpect(status().isUnauthorized())
        verifyNoInteractions(service)
    }
    @Test fun `episode mutations require server authentication and validate input`() {
        val base="/api/v1/works/work-id/episodes"
        for(path in listOf(base,base+"/1/versions",base+"/1/restore",base+"/1/publish")) {
            mvc.perform(post(path).contentType("application/json").content("""{"title":"회차","body":"원고","revision":0,"versionId":"v1","rightsConfirmed":true}""")).andExpect(status().isUnauthorized())
        }
        mvc.perform(put(base+"/1/draft").contentType("application/json").content("""{"title":"회차","body":"원고","revision":0}""")).andExpect(status().isUnauthorized())
        mvc.perform(get(base+"/1")).andExpect(status().isUnauthorized())
        mvc.perform(put(base+"/1/draft").principal { "verified-user" }.contentType("application/json").content("""{"title":"","body":"원고","revision":0}""")).andExpect(status().isUnprocessableEntity())
        verifyNoInteractions(service)
    }
    @Test fun `only authenticated principal determines owner`() {
        mvc.perform(get("/api/v1/works").principal { "verified-user" }).andExpect(status().isOk())
        verify(service).list("verified-user")
    }
    @Test fun `foreign origin cannot write even with principal`() {
        mvc.perform(post("/api/v1/works").principal { "verified-user" }.header("Origin","https://evil.example").contentType("application/json").content("""{"title":"test"}""")).andExpect(status().isForbidden())
        verifyNoInteractions(service)
    }
}
