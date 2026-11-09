package ai.storyfork.operations.security

import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations._common.exception.OperationsExceptionHandler
import ai.storyfork.operations.event.controller.AdminEventController
import ai.storyfork.operations.event.controller.PublicEventController
import ai.storyfork.operations.event.service.AdminEventService
import ai.storyfork.operations.event.service.EventService
import ai.storyfork.operations.event.service.dto.EventListResponse
import ai.storyfork.operations.report.controller.ReportController
import ai.storyfork.operations.report.service.ReportService
import ai.storyfork.operations.report.service.dto.ReportListResponse
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.context.annotation.Import
import org.springframework.data.domain.PageRequest
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.json.JsonMapper

/** CI integration only: MVC assembly of the member Bearer and public event chains next to the service-token chain. */
@WebMvcTest(controllers = [ReportController::class, AdminEventController::class, PublicEventController::class], properties = [
    "app.operations.service-token=ci-operations-test-only-0123456789abcdef",
])
@Import(MemberSecurityConfig::class, OperationsSecurityConfig::class, OperationsExceptionHandler::class,
    MemberSecurityIntegrationTest.MvcSecurity::class)
class MemberSecurityIntegrationTest {
    @TestConfiguration(proxyBeanMethods = false)
    @EnableWebSecurity
    class MvcSecurity

    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: JsonMapper
    @MockitoBean lateinit var core: CoreClient
    @MockitoBean lateinit var reports: ReportService
    @MockitoBean lateinit var adminEvents: AdminEventService
    @MockitoBean lateinit var events: EventService
    private val serviceToken = "ci-operations-test-only-0123456789abcdef"
    private val bearer = "Bearer member-access"

    private fun code(body: String) = mapper.readTree(body)["code"].asString()

    @Test
    fun `member routes require a Core verified Bearer and ignore the service token`() {
        for (path in listOf("/api/v1/operations/reports", "/api/v1/operations/reports/mine", "/api/v1/operations/members", "/api/v1/operations/admins")) {
            val response = mvc.perform(get(path).header("X-Operations-Service-Token", serviceToken))
                .andExpect(status().isUnauthorized()).andReturn().response
            assertEquals("UNAUTHORIZED", code(response.contentAsString))
            assertNull(response.getHeader("Set-Cookie"))
        }
        verifyNoInteractions(core)
    }

    @Test
    fun `verified member reaches the controller as principal without CSRF or session`() {
        val member = OperationsMember(UUID.randomUUID(), false)
        `when`(core.verify(bearer)).thenReturn(member)
        `when`(reports.mine(member)).thenReturn(ReportListResponse(emptyList()))

        val result = mvc.perform(get("/api/v1/operations/reports/mine").header("Authorization", bearer))
            .andExpect(status().isOk()).andReturn()

        assertNull(result.request.getSession(false))
        verify(reports).mine(member)
        mvc.perform(post("/api/v1/operations/reports/${UUID.randomUUID()}/restriction").header("Authorization", bearer))
            .andExpect(status().isOk())
    }

    @Test
    fun `Core verification failures keep 401 and 403 and otherwise return 502`() {
        for ((upstream, expected) in listOf(HttpStatus.UNAUTHORIZED to "UNAUTHORIZED", HttpStatus.FORBIDDEN to "FORBIDDEN",
            HttpStatus.BAD_GATEWAY to "UPSTREAM_FAILED")) {
            // doThrow: re-stubbing with when(core.verify(...)) would invoke the previous throwing stub.
            doThrow(ResponseStatusException(upstream)).`when`(core).verify(bearer)
            val response = mvc.perform(get("/api/v1/operations/reports/mine").header("Authorization", bearer)).andReturn().response
            assertEquals(upstream.value(), response.status)
            assertEquals(expected, code(response.contentAsString))
        }
    }

    @Test
    fun `existing service token routes still reject a member Bearer`() {
        mvc.perform(get("/api/v1/operations/notices").header("Authorization", bearer)).andExpect(status().isUnauthorized())
        verifyNoInteractions(core)
    }

    @Test
    fun `admin events require a Core verified Bearer and ignore the service token`() {
        val id = UUID.randomUUID()
        for (builder in listOf(
            get("/api/v1/operations/admin/events"), post("/api/v1/operations/admin/events"),
            get("/api/v1/operations/admin/events/$id"), put("/api/v1/operations/admin/events/$id"),
            delete("/api/v1/operations/admin/events/$id"),
        )) {
            val response = mvc.perform(builder.header("X-Operations-Service-Token", serviceToken))
                .andExpect(status().isUnauthorized()).andReturn().response
            assertEquals("UNAUTHORIZED", code(response.contentAsString))
            assertNull(response.getHeader("Set-Cookie"))
        }
        verifyNoInteractions(core, adminEvents)
    }

    @Test
    fun `verified member reaches the admin events controller as principal`() {
        val member = OperationsMember(UUID.randomUUID(), true)
        `when`(core.verify(bearer)).thenReturn(member)
        `when`(adminEvents.list(member)).thenReturn(EventListResponse(emptyList(), 0, 100, 0, 0))

        mvc.perform(get("/api/v1/operations/admin/events").header("Authorization", bearer)).andExpect(status().isOk())

        verify(adminEvents).list(member)
    }

    @Test
    fun `public events are readable without credentials and ignore any Bearer or service token`() {
        val missing = UUID.randomUUID()
        `when`(events.list(PageRequest.of(0, 100))).thenReturn(EventListResponse(emptyList(), 0, 100, 0, 0))
        `when`(events.read(missing)).thenThrow(NoSuchElementException())

        mvc.perform(get("/api/v1/operations/public/events")).andExpect(status().isOk())
        mvc.perform(get("/api/v1/operations/public/events").header("Authorization", "Bearer ignored")
            .header("X-Operations-Service-Token", serviceToken)).andExpect(status().isOk())
        mvc.perform(get("/api/v1/operations/public/events/$missing")).andExpect(status().isNotFound())

        verifyNoInteractions(core)
    }

    @Test
    fun `public events reject every method but GET with or without credentials`() {
        val path = "/api/v1/operations/public/events"
        val id = UUID.randomUUID()
        for (method in listOf(HttpMethod.POST, HttpMethod.PUT, HttpMethod.PATCH, HttpMethod.DELETE)) {
            for (uri in listOf(path, "$path/$id")) {
                val response = mvc.perform(request(method, uri)).andExpect(status().isForbidden()).andReturn().response
                assertEquals("FORBIDDEN", code(response.contentAsString))
                mvc.perform(request(method, uri).header("Authorization", bearer).header("X-Operations-Service-Token", serviceToken))
                    .andExpect(status().isForbidden())
            }
        }
        verifyNoInteractions(core, events)
    }

    @Test
    fun `the service token event route and lookalike paths stay closed to anonymous and Bearer callers`() {
        for (path in listOf("/api/v1/operations/events", "/api/v1/operations/public/eventsX", "/api/v1/operations/admin/eventsX")) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized())
            mvc.perform(get(path).header("Authorization", bearer)).andExpect(status().isUnauthorized())
        }
        verifyNoInteractions(core, events, adminEvents)
    }
}
