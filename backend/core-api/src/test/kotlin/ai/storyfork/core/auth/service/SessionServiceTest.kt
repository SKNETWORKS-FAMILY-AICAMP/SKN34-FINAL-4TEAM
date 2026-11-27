package ai.storyfork.core.auth.service

import ai.storyfork.core.auth.entity.AuthMember
import ai.storyfork.core.auth.entity.AuthRefreshToken
import ai.storyfork.core.auth.entity.AuthSession
import ai.storyfork.core.auth.helper.AuthTokenHelper
import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.repository.RefreshTokenRepository
import ai.storyfork.core.auth.repository.SessionRepository
import ai.storyfork.core.auth.service.dto.LoginRequest
import ai.storyfork.core.notification.repository.PushDeviceRepository
import jakarta.persistence.Tuple
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.mock
import org.mockito.Mockito.never
import org.mockito.Mockito.verify
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.verifyNoMoreInteractions
import org.mockito.Mockito.`when`
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.security.oauth2.jwt.JwtEncoder

class SessionServiceTest {
    private val members = mock(MemberRepository::class.java)
    private val sessions = mock(SessionRepository::class.java)
    private val tokens = mock(RefreshTokenRepository::class.java)
    private val passwords = BCryptPasswordEncoder(4)
    private val secrets = AuthTokenHelper()
    private val pushDevices = mock(PushDeviceRepository::class.java)
    private val service = SessionService(members, sessions, tokens, passwords, secrets, mock(JwtEncoder::class.java), pushDevices)
    private val member = AuthMember(UUID.randomUUID(), "reader@example.test", requireNotNull(passwords.encode("password-123")), "Reader")

    @Test
    fun `restricted member with correct password is refused without creating a session`() {
        member.restricted = true
        val credentials = mock(Tuple::class.java)
        `when`(credentials.get("passwordHash", String::class.java)).thenReturn(member.passwordHash)
        `when`(credentials.get("id", UUID::class.java)).thenReturn(member.id)
        `when`(members.findCredentialsByEmail(member.email)).thenReturn(credentials)
        `when`(members.lockByEmail(member.email)).thenReturn(member)

        val failure = assertThrows(AuthException::class.java) { service.login(LoginRequest(member.email, "password-123"), "test") }

        assertEquals(AuthException.Reason.RESTRICTED, failure.reason)
        verifyNoInteractions(sessions, tokens)
    }

    @Test
    fun `restricted member cannot rotate an existing refresh token`() {
        member.restricted = true
        `when`(tokens.findMemberId(secrets.hash("refresh-token"))).thenReturn(member.id)
        `when`(members.lockById(member.id)).thenReturn(member)

        assertNull(service.refresh("refresh-token"))
    }

    @Test
    fun `an already used refresh token is refused and revokes every session of the member`() {
        val hash = secrets.hash("used-token")
        val session = AuthSession(UUID.randomUUID(), member.id, "device", Instant.now(), Instant.now().plusSeconds(3600))
        `when`(tokens.findMemberId(hash)).thenReturn(member.id)
        `when`(members.lockById(member.id)).thenReturn(member)
        `when`(tokens.findById(hash)).thenReturn(Optional.of(AuthRefreshToken(hash, session.id, used = true)))
        `when`(sessions.findById(session.id)).thenReturn(Optional.of(session))

        assertNull(service.refresh("used-token"))

        verify(sessions).revokeAll(member.id)
        verify(pushDevices).deleteAllForMember(member.id)
        verify(tokens, never()).save(any(AuthRefreshToken::class.java))
    }

    private fun newSession() = AuthSession(UUID.randomUUID(), member.id, "device", Instant.now(), Instant.now().plusSeconds(3600))

    @Test
    fun `logout revokes the session and releases only its push device`() {
        val hash = secrets.hash("refresh-token")
        val session = newSession()
        `when`(tokens.findMemberId(hash)).thenReturn(member.id)
        `when`(members.lockById(member.id)).thenReturn(member)
        `when`(tokens.findById(hash)).thenReturn(Optional.of(AuthRefreshToken(hash, session.id)))
        `when`(sessions.findById(session.id)).thenReturn(Optional.of(session))

        assertTrue(service.logout("refresh-token"))

        assertTrue(session.revoked)
        verify(pushDevices).deleteForSession(session.id)
        verifyNoMoreInteractions(pushDevices)
    }

    @Test
    fun `revoking one session releases only that session push device`() {
        val session = newSession()
        `when`(members.lockById(member.id)).thenReturn(member)
        `when`(sessions.findByIdAndMemberIdAndRevokedFalse(session.id, member.id)).thenReturn(session)

        assertTrue(service.revoke(member.id, session.id))

        assertTrue(session.revoked)
        verify(pushDevices).deleteForSession(session.id)
        verifyNoMoreInteractions(pushDevices)
    }

    @Test
    fun `logging out everywhere revokes every session and releases every push device of the member`() {
        `when`(members.lockById(member.id)).thenReturn(member)
        `when`(tokens.findMemberId(secrets.hash("refresh-token"))).thenReturn(member.id)

        assertTrue(service.logoutAll(member.id, "refresh-token"))

        verify(sessions).revokeAll(member.id)
        verify(pushDevices).deleteAllForMember(member.id)
    }
}
