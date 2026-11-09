package ai.storyfork.operations.security

import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations._common.exception.OperationsExceptionHandler
import ai.storyfork.operations.notice.controller.AdminNoticeController
import ai.storyfork.operations.notice.controller.PublicNoticeController
import ai.storyfork.operations.notice.service.AdminNoticeService
import ai.storyfork.operations.notice.service.NoticeService
import ai.storyfork.operations.notice.service.dto.NoticeListResponse
import ai.storyfork.operations.notice.service.dto.NoticeRequest
import ai.storyfork.operations.notice.service.dto.NoticeResponse
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.mockito.Mockito.doThrow
import org.mockito.Mockito.verify
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.context.annotation.Import
import org.springframework.data.domain.PageRequest
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.header
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.json.JsonMapper

/** CI integration only: the admin Bearer chain and the anonymous GET-only public chain next to the service-token chain. */
@WebMvcTest(controllers = [AdminNoticeController::class, PublicNoticeController::class], properties = [
    "app.operations.service-token=ci-operations-test-only-0123456789abcdef",
])
@Import(MemberSecurityConfig::class, PublicNoticeSecurityConfig::class, OperationsSecurityConfig::class,
    OperationsExceptionHandler::class, NoticeSecurityIntegrationTest.MvcSecurity::class)
class NoticeSecurityIntegrationTest {
    @TestConfiguration(proxyBeanMethods = false)
    @EnableWebSecurity
    class MvcSecurity

    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: JsonMapper
    @MockitoBean lateinit var core: CoreClient
    @MockitoBean lateinit var adminNotices: AdminNoticeService
    @MockitoBean lateinit var notices: NoticeService
    private val serviceToken = "ci-operations-test-only-0123456789abcdef"
    private val bearer = "Bearer member-access"
    private val admin = OperationsMember(UUID.randomUUID(), true)
    private val id = UUID.randomUUID()
    private val adminBase = "/api/v1/operations/admin/notices"
    private val publicBase = "/api/v1/operations/public/notices"
    private val empty = NoticeListResponse(emptyList(), 0, 100, 0, 0)
    private val notice = NoticeResponse(id, "제목", "본문", Instant.EPOCH, Instant.EPOCH)
    private val writes = listOf<(String) -> MockHttpServletRequestBuilder>({ post(it) }, { put(it) }, { patch(it) }, { delete(it) })
    private val credentials = listOf<Pair<String, String>?>(null, "X-Operations-Service-Token" to serviceToken, "Authorization" to bearer)

    private fun code(body: String) = mapper.readTree(body)["code"].asString()

    private fun MockHttpServletRequestBuilder.with(credential: Pair<String, String>?) =
        apply { if (credential != null) header(credential.first, credential.second) }

    @Test
    fun `public notices are readable without credentials and ignore Bearer and service token`() {
        `when`(notices.list(PageRequest.of(0, 100))).thenReturn(empty)
        `when`(notices.read(id)).thenReturn(notice)

        // 목록과 /{id} 하위 경로 모두 securityMatcher와 GET permitAll에 걸려야 한다.
        for (credential in credentials) {
            for (path in listOf(publicBase, "$publicBase/$id")) {
                val response = mvc.perform(get(path).with(credential)).andExpect(status().isOk()).andReturn().response
                assertNull(response.getHeader("Set-Cookie"))
            }
        }
        verifyNoInteractions(core)
    }

    @Test
    fun `public notice routes reject every non GET method even with credentials`() {
        for (path in listOf(publicBase, "$publicBase/$id")) {
            for (write in writes) {
                for (credential in credentials) {
                    val response = mvc.perform(write(path).with(credential)).andExpect(status().isForbidden()).andReturn().response
                    assertEquals("FORBIDDEN", code(response.contentAsString))
                    assertNull(response.getHeader("Set-Cookie"))
                }
            }
        }
        verifyNoInteractions(core, adminNotices, notices)
    }

    @Test
    fun `the service-token chain still owns the legacy notices route and public look-alike paths`() {
        // 공개 체인은 /public/notices와 그 하위 경로만 매칭한다. 기존 /notices와 notices-x 같은 접두 변형은 토큰 없이 401이다.
        for (path in listOf("/api/v1/operations/notices", "$publicBase-x")) {
            val response = mvc.perform(get(path)).andExpect(status().isUnauthorized()).andReturn().response
            assertEquals("UNAUTHORIZED", code(response.contentAsString))
        }
    }

    @Test
    fun `admin notice routes require a Core verified Bearer and ignore the service token`() {
        for (path in listOf(adminBase, "$adminBase/$id")) {
            for (method in writes + { url: String -> get(url) }) {
                val response = mvc.perform(method(path).header("X-Operations-Service-Token", serviceToken))
                    .andExpect(status().isUnauthorized()).andReturn().response
                assertEquals("UNAUTHORIZED", code(response.contentAsString))
                assertNull(response.getHeader("Set-Cookie"))
            }
        }
        verifyNoInteractions(core, adminNotices)
    }

    @Test
    fun `verified Bearer reaches the admin service as principal and its results map to HTTP`() {
        `when`(core.verify(bearer)).thenReturn(admin)
        `when`(adminNotices.list(admin)).thenReturn(empty)
        `when`(adminNotices.create(admin, NoticeRequest("제목", "본문"))).thenReturn(notice)

        mvc.perform(get(adminBase).header("Authorization", bearer)).andExpect(status().isOk())
        mvc.perform(post(adminBase).header("Authorization", bearer).contentType(MediaType.APPLICATION_JSON).content("""{"title":"제목","body":"본문"}"""))
            .andExpect(status().isCreated()).andExpect(header().string("Location", "$adminBase/$id"))
        mvc.perform(delete("$adminBase/$id").header("Authorization", bearer)).andExpect(status().isNoContent())

        verify(adminNotices).list(admin)
        verify(adminNotices).delete(admin, id)
    }

    @Test
    fun `a verified member without the notices permission gets 403`() {
        `when`(core.verify(bearer)).thenReturn(admin)
        doThrow(ResponseStatusException(HttpStatus.FORBIDDEN)).`when`(adminNotices).list(admin)

        val response = mvc.perform(get(adminBase).header("Authorization", bearer)).andExpect(status().isForbidden()).andReturn().response

        assertEquals("FORBIDDEN", code(response.contentAsString))
    }
}
