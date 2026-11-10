package ai.storyfork.operations.security

import ai.storyfork.operations._common.exception.OperationsExceptionHandler
import jakarta.persistence.OptimisticLockException
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.context.annotation.Import
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
import org.springframework.security.core.Authentication
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RestController
import tools.jackson.databind.json.JsonMapper

/** CI integration only: actual MVC/security assembly; no production probe endpoint is added. */
@WebMvcTest(controllers = [OperationsSecurityIntegrationTest.ProbeController::class], properties = [
    "app.operations.service-token=ci-operations-test-only-0123456789abcdef",
])
@Import(OperationsSecurityConfig::class, OperationsExceptionHandler::class,
    OperationsSecurityIntegrationTest.ProbeController::class, OperationsSecurityIntegrationTest.MvcSecurity::class)
class OperationsSecurityIntegrationTest {
    @TestConfiguration(proxyBeanMethods = false)
    @EnableWebSecurity
    class MvcSecurity

    @RestController
    class ProbeController {
        @PostMapping("/api/v1/operations/probe")
        fun create(authentication: Authentication) = mapOf("principal" to authentication.name)

        @GetMapping("/api/v1/operations/probe/not-found")
        fun missing(): Nothing = throw NoSuchElementException("private record")

        @GetMapping("/api/v1/operations/probe/invalid")
        fun invalid(): Nothing = throw IllegalArgumentException("private body")

        @GetMapping("/api/v1/operations/probe/conflict")
        fun conflict(): Nothing = throw OptimisticLockException("private SQL")

        @GetMapping("/api/v1/operations/probe/reference-conflict")
        fun referenceConflict(): Nothing = throw DataIntegrityViolationException("private SQL")

        @GetMapping("/api/v1/operations/probe/failure")
        fun failure(): Nothing = throw IllegalStateException("private secret")
    }

    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: JsonMapper
    private val token = "ci-operations-test-only-0123456789abcdef"

    @Test
    fun `all resource routes reject absent or incorrect service credentials without a browser session`() {
        for (path in listOf("/api/v1/operations/notices", "/api/v1/operations/events", "/api/v1/operations/inquiries")) {
            for (method in listOf(get(path), post(path), put(path), delete(path))) {
                val response = mvc.perform(method.header("X-Operations-Service-Token", "wrong"))
                    .andExpect(status().isUnauthorized()).andReturn().response
                assertEquals("UNAUTHORIZED", mapper.readTree(response.contentAsString)["code"].asString())
                assertNull(response.getHeader("Set-Cookie"))
            }
            mvc.perform(get(path).header("Authorization", "Bearer $token"))
                .andExpect(status().isUnauthorized())
        }
    }

    @Test
    fun `correct header needs no CSRF cookie while the next request is still unauthenticated`() {
        val result = mvc.perform(post("/api/v1/operations/probe").header("X-Operations-Service-Token", token))
            .andExpect(status().isOk()).andReturn()
        assertNull(result.request.getSession(false))
        assertNull(result.response.getHeader("Set-Cookie"))
        assertEquals("operations-service", mapper.readTree(result.response.contentAsString)["principal"].asString())
        mvc.perform(post("/api/v1/operations/probe")).andExpect(status().isUnauthorized())
        val denied = mvc.perform(get("/api/v1/unrelated").header("X-Operations-Service-Token", token))
            .andExpect(status().isForbidden()).andReturn().response
        assertEquals("FORBIDDEN", mapper.readTree(denied.contentAsString)["code"].asString())
    }

    @Test
    fun `MVC shared errors never return exception messages`() {
        for ((path, expectedStatus, code) in listOf(
            Triple("not-found", 404, "NOT_FOUND"), Triple("invalid", 400, "INVALID_REQUEST"),
            Triple("conflict", 409, "CONFLICT"), Triple("reference-conflict", 409, "CONFLICT"),
            Triple("failure", 500, "INTERNAL_ERROR"))) {
            val response = mvc.perform(get("/api/v1/operations/probe/$path").header("X-Operations-Service-Token", token))
                .andExpect(status().`is`(expectedStatus)).andReturn().response
            assertEquals(code, mapper.readTree(response.contentAsString)["code"].asString())
            assertFalse(response.contentAsString.contains("private"))
        }
    }

    @Test
    fun `unknown routes and wrong methods get the shared error DTO instead of the container error page`() {
        for ((request, expectedStatus, code) in listOf(
            Triple(get("/api/v1/operations/unknown"), 404, "NOT_FOUND"),
            Triple(delete("/api/v1/operations/probe"), 405, "REQUEST_FAILED"))) {
            val response = mvc.perform(request.header("X-Operations-Service-Token", token))
                .andExpect(status().`is`(expectedStatus)).andReturn().response
            assertEquals(code, mapper.readTree(response.contentAsString)["code"].asString())
        }
    }
}
