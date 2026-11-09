package ai.storyfork.core.auth

import ai.storyfork.core.auth.entity.AuthMember
import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.service.AuthException
import ai.storyfork.core.auth.service.AuthVerificationService
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`

class ContentServiceCredentialTest {
    private val members = mock(MemberRepository::class.java)
    private val content = "test-only-service-credential-32-bytes"
    private val operations = "test-only-operations-credential-32-bytes"

    @Test fun `empty configuration missing header wrong service token and user bearer never authenticate a service`() {
        assertFalse(AuthVerificationService(members, "", "").isTrusted(content, content))
        assertFalse(AuthVerificationService(members, "short", "short").isTrusted("short", "short"))
        val service = AuthVerificationService(members, content, operations)
        for (input in listOf(null, "", "wrong", "Bearer $content")) {
            assertFalse(service.isTrusted(input, null))
            assertFalse(service.isTrusted(null, input))
            assertFalse(service.isOperations(input))
        }
        assertTrue(service.isTrusted(content, null))
        assertTrue(service.isTrusted("wrong", operations))
        assertTrue(service.isOperations(operations))
        // Content credential is limited to verify; operations-only APIs never accept it.
        assertFalse(service.isOperations(content))
        assertFalse(service.isTrusted(operations, content))
    }

    @Test fun `only an existing unrestricted member with a canonical UUID subject is verified with its role`() {
        val service = AuthVerificationService(members, "", "")
        val admin = AuthMember(UUID.randomUUID(), "admin@example.test", "hash", "admin", operator = true)
        `when`(members.findById(admin.id)).thenReturn(Optional.of(admin))
        val verified = service.verify(admin.id.toString())
        assertEquals(admin.id, verified.memberId)
        assertTrue(verified.operator)
        // 댓글 작성자 표시명의 정본은 회원 닉네임이다(Content가 작성 시 스냅샷으로 저장).
        assertEquals("admin", verified.nickname)
        for (value in listOf(null, "forged-owner", "1-1-1-1-1", "", UUID.randomUUID().toString())) {
            assertEquals(AuthException.Reason.UNAUTHENTICATED, assertThrows(AuthException::class.java) { service.verify(value) }.reason)
        }
        admin.restricted = true
        // 제한 회원은 유효한 세션이 없는 것으로 보아 401: Content가 403을 서비스 자격 오류(502)로 바꾸지 않게 한다.
        assertEquals(AuthException.Reason.UNAUTHENTICATED, assertThrows(AuthException::class.java) { service.verify(admin.id.toString()) }.reason)
    }
}
