package ai.storyfork.operations.activity

import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations.activity.entity.AdminActivityEntity
import ai.storyfork.operations.activity.repository.AdminActivityRepository
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.service.dto.MemberItem
import ai.storyfork.operations.member.service.dto.MemberListResponse
import ai.storyfork.operations.security.OperationsMember
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentCaptor
import org.mockito.Mockito.*
import org.springframework.data.domain.Sort
import org.springframework.data.repository.query.parser.PartTree
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** Mocked repositories and Core client: no Spring context, HTTP or database. */
class AdminActivityServiceTest {
    private val activities = mock(AdminActivityRepository::class.java)
    private val permissions = mock(AdminPermissionRepository::class.java)
    private val core = mock(CoreClient::class.java)
    private val service = AdminActivityService(activities, permissions, core)

    private val admin = OperationsMember(UUID.randomUUID(), true)
    private val operatorWithoutAdmins = OperationsMember(UUID.randomUUID(), true)
    private val staleGrant = OperationsMember(UUID.randomUUID(), false)
    private val bearer = "Bearer admin-access"
    private val time = Instant.parse("2026-11-10T01:00:00Z")

    private fun givenAdminsPermission() {
        `when`(permissions.existsByMemberIdAndPermission(admin.memberId, "admins")).thenReturn(true)
        // A non-operator must stay denied even if a stale permission row exists.
        `when`(permissions.existsByMemberIdAndPermission(staleGrant.memberId, "admins")).thenReturn(true)
        // Another business permission never replaces `admins`.
        `when`(permissions.existsByMemberIdAndPermission(operatorWithoutAdmins.memberId, "users")).thenReturn(true)
    }

    private fun row(actor: UUID, action: String, targetType: String, targetId: String, detail: String?, createdAt: Instant) =
        AdminActivityEntity(actorId = actor, action = action, targetType = targetType, targetId = targetId, detail = detail, createdAt = createdAt)

    private fun admin(id: UUID, nickname: String) = MemberItem(id, "$nickname@example.test", nickname, "ADMIN", false, Instant.EPOCH)

    private fun savedRows(): List<AdminActivityEntity> {
        val captor = ArgumentCaptor.forClass(AdminActivityEntity::class.java)
        verify(activities, atLeastOnce()).saveAndFlush(captor.capture())
        return captor.allValues
    }

    private fun assertStatus(status: HttpStatus, call: () -> Unit) {
        assertEquals(status, assertThrows(ResponseStatusException::class.java) { call() }.statusCode)
    }

    @Test
    fun `record stores the actor action target and detail with a generated id and the current time`() {
        val targetId = UUID.randomUUID()
        val before = Instant.now().truncatedTo(ChronoUnit.MICROS)

        service.record(admin, "NOTICE_UPDATE", "NOTICE", targetId, "공지 제목")

        val saved = savedRows().single()
        assertEquals(admin.memberId, saved.actorId)
        assertEquals("NOTICE_UPDATE", saved.action)
        assertEquals("NOTICE", saved.targetType)
        assertEquals(targetId.toString(), saved.targetId)
        assertEquals("공지 제목", saved.detail)
        assertFalse(saved.createdAt.isBefore(before))
    }

    @Test
    fun `record keeps a missing detail null cuts a longer one to 500 characters and gives every row its own id`() {
        val id = UUID.randomUUID()

        service.record(admin, "NOTICE_DELETE", "NOTICE", id, null)
        service.record(admin, "WORK_RESTRICT", "WORK", id, "가".repeat(500))
        service.record(admin, "WORK_RESTRICT", "WORK", id, "나".repeat(501))

        val saved = savedRows()
        assertEquals(listOf(null, "가".repeat(500), "나".repeat(500)), saved.map { it.detail })
        assertEquals(3, saved.map { it.id }.distinct().size)
    }

    @Test
    fun `a failed save reaches the caller instead of being swallowed`() {
        val failure = IllegalStateException("db down")
        doThrow(failure).`when`(activities).saveAndFlush(any(AdminActivityEntity::class.java) ?: row(admin.memberId, "A", "T", "1", null, time))

        assertSame(failure, assertThrows(IllegalStateException::class.java) {
            service.record(admin, "NOTICE_DELETE", "NOTICE", UUID.randomUUID(), null)
        })
    }

    @Test
    fun `list is denied before the database or Core unless an operator holds the admins permission`() {
        givenAdminsPermission()

        for (denied in listOf(operatorWithoutAdmins, staleGrant)) assertStatus(HttpStatus.FORBIDDEN) { service.list(denied, bearer) }

        verifyNoInteractions(activities, core)
    }

    @Test
    fun `list maps the latest rows with the nickname from one Core admin list and null for an unknown admin`() {
        givenAdminsPermission()
        val known = UUID.randomUUID()
        val gone = UUID.randomUUID()
        val newer = row(known, "NOTICE_CREATE", "NOTICE", "n-1", "새 공지", time.plusSeconds(60))
        val older = row(gone, "MEMBER_RESTRICT", "MEMBER", "m-1", null, time)
        `when`(activities.findTop100ByOrderByCreatedAtDescIdDesc()).thenReturn(listOf(newer, older))
        `when`(core.members(bearer, "ADMIN", null, null)).thenReturn(MemberListResponse(listOf(admin(known, "관리자"), admin(UUID.randomUUID(), "다른"))))

        val items = service.list(admin, bearer).items

        assertEquals(listOf(newer.id, older.id), items.map { it.id })
        assertEquals(listOf(known, gone), items.map { it.actorId })
        assertEquals(listOf("관리자", null), items.map { it.actorNickname })
        assertEquals(listOf("NOTICE_CREATE", "MEMBER_RESTRICT"), items.map { it.action })
        assertEquals(listOf("NOTICE" to "n-1", "MEMBER" to "m-1"), items.map { it.targetType to it.targetId })
        assertEquals(listOf("새 공지", null), items.map { it.detail })
        assertEquals(listOf(time.plusSeconds(60), time), items.map { it.createdAt })
        verify(core, times(1)).members(bearer, "ADMIN", null, null)
        verifyNoMoreInteractions(core)
    }

    @Test
    fun `the list query is the latest 100 ordered by created time then id both descending`() {
        // Static check of the derived query name (no database): the only declared method is the one `list` relies on.
        val tree = PartTree(AdminActivityRepository::class.java.declaredMethods.single().name, AdminActivityEntity::class.java)

        assertEquals(100, tree.maxResults)
        assertEquals(Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id")), tree.sort)
    }

    @Test
    fun `an empty list does not call Core`() {
        givenAdminsPermission()
        `when`(activities.findTop100ByOrderByCreatedAtDescIdDesc()).thenReturn(emptyList())

        assertEquals(emptyList<Any>(), service.list(admin, bearer).items)

        verifyNoInteractions(core)
    }

    @Test
    fun `a Core failure is a 502 and never an empty or nickname less list`() {
        givenAdminsPermission()
        `when`(activities.findTop100ByOrderByCreatedAtDescIdDesc()).thenReturn(listOf(row(admin.memberId, "NOTICE_DELETE", "NOTICE", "n-1", null, time)))
        `when`(core.members(bearer, "ADMIN", null, null)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        assertStatus(HttpStatus.BAD_GATEWAY) { service.list(admin, bearer) }
    }
}
