package ai.storyfork.core.auth.service

import ai.storyfork.core.auth.entity.AuthMember
import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.service.dto.AdminCreateRequest
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.ArgumentCaptor
import org.mockito.Mockito.any
import org.mockito.Mockito.mock
import org.mockito.Mockito.never
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Sort
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder

class MemberAdminServiceTest {
    private val members = mock(MemberRepository::class.java)
    private val passwords = BCryptPasswordEncoder(4)
    private val service = MemberAdminService(members, AuthVerificationService(members, "", ""), passwords)
    private val admin = AuthMember(UUID.randomUUID(), "admin@example.test", "hash", "운영자", operator = true)
    private val reader = AuthMember(UUID.randomUUID(), "reader@example.test", "hash", "Reader",
        createdAt = Instant.parse("2026-01-02T03:04:05Z"))

    init {
        `when`(members.findById(admin.id)).thenReturn(Optional.of(admin))
        `when`(members.findById(reader.id)).thenReturn(Optional.of(reader))
        // 제한 전환은 refresh·복구와 같은 회원 행 잠금으로 직렬화한다.
        `when`(members.lockById(reader.id)).thenReturn(reader)
        `when`(members.lockById(admin.id)).thenReturn(admin)
    }

    private fun reason(block: () -> Unit) = assertThrows(AuthException::class.java) { block() }.reason

    @Test
    fun `non operator, restricted operator, unknown and malformed actors are rejected before any admin action`() {
        assertEquals(AuthException.Reason.FORBIDDEN, reason { service.list(reader.id.toString(), "ALL", "", "newest") })
        assertEquals(AuthException.Reason.UNAUTHENTICATED, reason { service.restrict(UUID.randomUUID().toString(), reader.id) })
        assertEquals(AuthException.Reason.UNAUTHENTICATED, reason { service.list("not-a-uuid", "ALL", "", "newest") })
        admin.restricted = true
        assertEquals(AuthException.Reason.UNAUTHENTICATED, reason { service.list(admin.id.toString(), "ALL", "", "newest") })
        assertFalse(reader.restricted)
    }

    @Test
    fun `list maps role filter, escaped case insensitive query and sort to a 200 item JPQL page`() {
        val page = PageRequest.of(0, 200, Sort.by(Sort.Order.desc("createdAt"), Sort.Order.asc("id")))
        `when`(members.search(listOf(false), "%a!%b!_c!!%", page)).thenReturn(listOf(reader))

        val items = service.list(admin.id.toString(), "MEMBER", "  A%b_C! ", "newest").items

        assertEquals(1, items.size)
        val item = items.single()
        assertEquals(reader.id, item.id)
        assertEquals("MEMBER", item.role)
        assertEquals(Instant.parse("2026-01-02T03:04:05Z"), item.createdAt)

        val oldest = PageRequest.of(0, 200, Sort.by(Sort.Order.asc("createdAt"), Sort.Order.asc("id")))
        `when`(members.search(listOf(true, false), "%%", oldest)).thenReturn(listOf(admin))
        assertEquals("ADMIN", service.list(admin.id.toString(), "ALL", "", "oldest").items.single().role)
        `when`(members.search(listOf(true), "%%", page)).thenReturn(emptyList())
        assertTrue(service.list(admin.id.toString(), "ADMIN", "", "newest").items.isEmpty())

        assertEquals(AuthException.Reason.INVALID, reason { service.list(admin.id.toString(), "OWNER", "", "newest") })
        assertEquals(AuthException.Reason.INVALID, reason { service.list(admin.id.toString(), "ALL", "", "random") })
    }

    @Test
    fun `restriction toggles the target, rejects self and reports missing members`() {
        assertTrue(service.restrict(admin.id.toString(), reader.id).restricted)
        assertTrue(reader.restricted)
        assertFalse(service.unrestrict(admin.id.toString(), reader.id).restricted)
        assertFalse(reader.restricted)
        org.mockito.Mockito.verify(members, org.mockito.Mockito.times(2)).lockById(reader.id)

        assertEquals(AuthException.Reason.INVALID, reason { service.restrict(admin.id.toString(), admin.id) })
        assertEquals(AuthException.Reason.INVALID, reason { service.unrestrict(admin.id.toString(), admin.id) })
        assertFalse(admin.restricted)
        assertEquals(AuthException.Reason.NOT_FOUND, reason { service.restrict(admin.id.toString(), UUID.randomUUID()) })
    }

    @Test
    fun `create admin stores a normalized operator with a bcrypt hash and maps duplicates to conflict`() {
        `when`(members.saveAndFlush(any(AuthMember::class.java))).thenAnswer { it.arguments[0] }

        val item = service.createAdmin(admin.id.toString(), AdminCreateRequest(" New@Example.Test ", " 새 관리자 ", "password-123"))

        val saved = ArgumentCaptor.forClass(AuthMember::class.java)
        verify(members).saveAndFlush(saved.capture())
        assertEquals("new@example.test", saved.value.email)
        assertEquals("새 관리자", saved.value.nickname)
        assertTrue(saved.value.operator)
        assertFalse(saved.value.restricted)
        assertTrue(passwords.matches("password-123", saved.value.passwordHash))
        assertEquals("ADMIN", item.role)
        assertEquals("new@example.test", item.email)

        `when`(members.existsByEmail("dup@example.test")).thenReturn(true)
        assertEquals(AuthException.Reason.CONFLICT, reason {
            service.createAdmin(admin.id.toString(), AdminCreateRequest("dup@example.test", "dup", "password-123"))
        })
        `when`(members.saveAndFlush(any(AuthMember::class.java))).thenThrow(DataIntegrityViolationException("race"))
        assertEquals(AuthException.Reason.CONFLICT, reason {
            service.createAdmin(admin.id.toString(), AdminCreateRequest("race@example.test", "race", "password-123"))
        })
        assertEquals(AuthException.Reason.INVALID, reason {
            service.createAdmin(admin.id.toString(), AdminCreateRequest("long@example.test", "long", "가".repeat(25)))
        })
    }

    @Test
    fun `non operator cannot create admins`() {
        assertEquals(AuthException.Reason.FORBIDDEN, reason {
            service.createAdmin(reader.id.toString(), AdminCreateRequest("x@example.test", "x", "password-123"))
        })
        verify(members, never()).saveAndFlush(any(AuthMember::class.java))
    }
}
