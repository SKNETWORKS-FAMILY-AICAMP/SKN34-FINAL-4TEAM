package ai.storyfork.operations.activity

import ai.storyfork.operations.activity.controller.AdminActivityController
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.activity.service.dto.AdminActivityListResponse
import ai.storyfork.operations.activity.service.dto.AdminActivityResponse
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** Spring context나 HTTP 서버 없이 인증 회원·Bearer 전달과 계약 JSON 필드를 확인한다. */
class AdminActivityControllerTest {
    private val service = mock(AdminActivityService::class.java)
    private val controller = AdminActivityController(service)
    private val member = OperationsMember(UUID.randomUUID(), true)

    @Test
    fun `list passes the authenticated member and the admin bearer and returns the service DTO`() {
        val list = AdminActivityListResponse(emptyList())
        `when`(service.list(member, "Bearer admin-access")).thenReturn(list)

        assertSame(list, controller.list(member, "Bearer admin-access"))
    }

    @Test
    fun `an activity serializes with exactly the contract fields and keeps a null nickname and detail`() {
        val id = UUID.randomUUID()
        val actor = UUID.randomUUID()
        val list = AdminActivityListResponse(listOf(
            AdminActivityResponse(id, actor, null, "NOTICE_DELETE", "NOTICE", "n-1", null, Instant.parse("2026-11-10T01:02:03Z")),
        ))
        val mapper = jacksonMapperBuilder().build()

        val item = mapper.readTree(mapper.writeValueAsString(list)).path("items").path(0)

        assertEquals(8, item.size())
        assertEquals(id.toString(), item.path("id").asString())
        assertEquals(actor.toString(), item.path("actorId").asString())
        assertTrue(item.path("actorNickname").isNull)
        assertEquals("NOTICE_DELETE", item.path("action").asString())
        assertEquals("NOTICE", item.path("targetType").asString())
        assertEquals("n-1", item.path("targetId").asString())
        assertTrue(item.path("detail").isNull)
        assertEquals("2026-11-10T01:02:03Z", item.path("createdAt").asString())
    }
}
