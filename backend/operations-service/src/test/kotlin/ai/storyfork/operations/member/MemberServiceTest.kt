package ai.storyfork.operations.member

import ai.storyfork.operations._common.client.CoreAdminRequest
import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.member.entity.AdminPermissionEntity
import ai.storyfork.operations.member.repository.ADMIN_PERMISSIONS
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.service.MemberService
import ai.storyfork.operations.member.service.dto.CreateAdminRequest
import ai.storyfork.operations.member.service.dto.MemberItem
import ai.storyfork.operations.member.service.dto.MemberListResponse
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentCaptor
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** Mocked Core client and repository: no Spring context, HTTP or database. */
class MemberServiceTest {
    private val core = mock(CoreClient::class.java)
    private val permissions = mock(AdminPermissionRepository::class.java)
    private val activities = mock(AdminActivityService::class.java)
    private val service = MemberService(core, permissions, activities)
    private val admin = OperationsMember(UUID.randomUUID(), true)
    private val member = OperationsMember(UUID.randomUUID(), false)
    private val bearer = "Bearer admin-access"
    private val targetId = UUID.randomUUID()

    private fun item(id: UUID = targetId, role: String = "MEMBER") =
        MemberItem(id, "a@example.test", "닉", role, false, Instant.EPOCH)

    private fun grant(vararg keys: String) = keys.forEach {
        `when`(permissions.existsByMemberIdAndPermission(admin.memberId, it)).thenReturn(true)
        `when`(permissions.existsByMemberIdAndPermission(member.memberId, it)).thenReturn(true)
    }

    private fun assertForbidden(call: () -> Unit) {
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException::class.java) { call() }.statusCode)
    }

    @Test
    fun `member operations require operator with users permission and forward the admin bearer`() {
        grant("users")
        assertForbidden { service.list(member, bearer, null, null, null) }
        `when`(core.members(bearer, "MEMBER", "kim", "oldest")).thenReturn(MemberListResponse(listOf(item())))
        `when`(core.restrict(bearer, targetId)).thenReturn(item().copy(restricted = true))
        `when`(core.unrestrict(bearer, targetId)).thenReturn(item())

        assertEquals(listOf(targetId), service.list(admin, bearer, "MEMBER", "kim", "oldest").items.map { it.id })
        assertTrue(service.restrict(admin, bearer, targetId).restricted)
        assertFalse(service.unrestrict(admin, bearer, targetId).restricted)
    }

    @Test
    fun `restrict and unrestrict record the admin activity with the target nickname after Core succeeds`() {
        grant("users")
        `when`(core.restrict(bearer, targetId)).thenReturn(item().copy(restricted = true))
        `when`(core.unrestrict(bearer, targetId)).thenReturn(item())

        service.restrict(admin, bearer, targetId)
        service.unrestrict(admin, bearer, targetId)

        val order = inOrder(core, activities)
        order.verify(core).restrict(bearer, targetId)
        order.verify(activities).record(admin, "MEMBER_RESTRICT", "MEMBER", targetId, "닉")
        order.verify(core).unrestrict(bearer, targetId)
        order.verify(activities).record(admin, "MEMBER_UNRESTRICT", "MEMBER", targetId, "닉")
        verifyNoMoreInteractions(activities)
    }

    @Test
    fun `admin creation records ADMIN_CREATE with the email and permission keys after the permissions are saved`() {
        grant("admins")
        `when`(core.createAdmin(bearer, CoreAdminRequest("n@example.test", "새 관리자", "password1")))
            .thenReturn(item(role = "ADMIN").copy(email = "n@example.test"))

        service.createAdmin(admin, bearer, CreateAdminRequest("n@example.test", "새 관리자", "password1", listOf("users", "rights", "users")))

        val order = inOrder(core, permissions, activities)
        order.verify(core).createAdmin(bearer, CoreAdminRequest("n@example.test", "새 관리자", "password1"))
        order.verify(permissions).saveAllAndFlush(anyList<AdminPermissionEntity>())
        order.verify(activities).record(admin, "ADMIN_CREATE", "MEMBER", targetId, "n@example.test · users,rights")
        verifyNoMoreInteractions(activities)
    }

    @Test
    fun `a denied invalid or failed member operation records no activity`() {
        grant("users", "admins")
        val operatorWithoutPermission = OperationsMember(UUID.randomUUID(), true)
        val newAdmin = CreateAdminRequest("n@example.test", "새", "password1", listOf("users"))
        for (denied in listOf(member, operatorWithoutPermission)) {
            assertForbidden { service.restrict(denied, bearer, targetId) }
            assertForbidden { service.unrestrict(denied, bearer, targetId) }
            assertForbidden { service.createAdmin(denied, bearer, newAdmin) }
        }
        assertThrows(IllegalArgumentException::class.java) { service.createAdmin(admin, bearer, newAdmin.copy(permissions = listOf("root"))) }
        `when`(core.restrict(bearer, targetId)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))
        `when`(core.unrestrict(bearer, targetId)).thenThrow(ResponseStatusException(HttpStatus.NOT_FOUND))
        `when`(core.createAdmin(bearer, CoreAdminRequest("n@example.test", "새", "password1"))).thenThrow(ResponseStatusException(HttpStatus.CONFLICT))

        assertThrows(ResponseStatusException::class.java) { service.restrict(admin, bearer, targetId) }
        assertThrows(ResponseStatusException::class.java) { service.unrestrict(admin, bearer, targetId) }
        assertThrows(ResponseStatusException::class.java) { service.createAdmin(admin, bearer, newAdmin) }

        verifyNoInteractions(activities)
    }

    @Test
    fun `no activity is recorded when saving the new admins permissions fails`() {
        grant("admins")
        `when`(core.createAdmin(bearer, CoreAdminRequest("n@example.test", "새 관리자", "password1"))).thenReturn(item(role = "ADMIN"))
        doThrow(IllegalStateException("db down")).`when`(permissions).saveAllAndFlush(anyList<AdminPermissionEntity>())

        assertThrows(IllegalStateException::class.java) {
            service.createAdmin(admin, bearer, CreateAdminRequest("n@example.test", "새 관리자", "password1", listOf("users")))
        }

        verifyNoInteractions(activities)
    }

    @Test
    fun `operator without users permission is denied before Core`() {
        val operator = OperationsMember(UUID.randomUUID(), true)
        assertForbidden { service.restrict(operator, bearer, targetId) }
        assertForbidden { service.unrestrict(operator, bearer, targetId) }
        verifyNoInteractions(core)
    }

    @Test
    fun `admin list merges stored permissions in canonical order`() {
        grant("admins")
        val other = UUID.randomUUID()
        `when`(core.members(bearer, "ADMIN", null, null)).thenReturn(MemberListResponse(listOf(item(targetId, "ADMIN"), item(other, "ADMIN"))))
        `when`(permissions.findAllByMemberIdIn(listOf(targetId, other))).thenReturn(listOf(
            AdminPermissionEntity(targetId, "users"), AdminPermissionEntity(targetId, "works"),
        ))

        val result = service.admins(admin, bearer).items

        assertEquals(listOf("works", "users"), result[0].permissions)
        assertEquals(emptyList<String>(), result[1].permissions)
        assertForbidden { service.admins(member, bearer) }
    }

    @Test
    fun `admin creation validates permission keys before Core`() {
        grant("admins")
        for (keys in listOf(emptyList(), listOf("unknown"), listOf("users", "root"))) {
            assertThrows(IllegalArgumentException::class.java) {
                service.createAdmin(admin, bearer, CreateAdminRequest("n@example.test", "새 관리자", "password1", keys))
            }
        }
        assertForbidden { service.createAdmin(member, bearer, CreateAdminRequest("n@example.test", "새", "password1", listOf("users"))) }
        verifyNoInteractions(core)
    }

    @Test
    fun `admin creation stores deduplicated permissions after Core creates the account`() {
        grant("admins")
        `when`(core.createAdmin(bearer, CoreAdminRequest("n@example.test", "새 관리자", "password1"))).thenReturn(item(role = "ADMIN"))

        val result = service.createAdmin(admin, bearer, CreateAdminRequest("n@example.test", "새 관리자", "password1", listOf("users", "rights", "users")))

        assertEquals("ADMIN", result.role)
        assertEquals(listOf("users", "rights"), result.permissions)
        @Suppress("UNCHECKED_CAST")
        val captor = ArgumentCaptor.forClass(List::class.java) as ArgumentCaptor<List<AdminPermissionEntity>>
        verify(permissions).saveAllAndFlush(captor.capture())
        assertEquals(listOf(targetId to "users", targetId to "rights"), captor.value.map { it.memberId to it.permission })
        assertEquals(12, ADMIN_PERMISSIONS.size)
    }

    @Test
    fun `Core failure during admin creation stores no permissions`() {
        grant("admins")
        `when`(core.createAdmin(bearer, CoreAdminRequest("dup@example.test", "중복", "password1")))
            .thenThrow(ResponseStatusException(HttpStatus.CONFLICT))

        assertThrows(ResponseStatusException::class.java) {
            service.createAdmin(admin, bearer, CreateAdminRequest("dup@example.test", "중복", "password1", listOf("users")))
        }
        verify(permissions, never()).saveAllAndFlush(anyList<AdminPermissionEntity>())
    }
}
