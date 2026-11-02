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
    @Test fun `only authenticated principal determines owner`() {
        mvc.perform(get("/api/v1/works").principal { "verified-user" }).andExpect(status().isOk())
        verify(service).list("verified-user")
    }
    @Test fun `foreign origin cannot write even with principal`() {
        mvc.perform(post("/api/v1/works").principal { "verified-user" }.header("Origin","https://evil.example").contentType("application/json").content("""{"title":"test"}""")).andExpect(status().isForbidden())
        verifyNoInteractions(service)
    }
}
