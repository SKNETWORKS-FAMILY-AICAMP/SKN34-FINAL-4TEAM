package ai.storyfork.core.auth.service

import ai.storyfork.core.auth.entity.AuthMember
import ai.storyfork.core.auth.entity.AuthRefreshToken
import ai.storyfork.core.auth.entity.AuthSession
import ai.storyfork.core.auth.helper.AuthTokenHelper
import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.repository.RefreshTokenRepository
import ai.storyfork.core.auth.repository.SessionRepository
import ai.storyfork.core.auth.service.dto.LoginRequest
import ai.storyfork.core.auth.service.dto.MemberResponse
import jakarta.persistence.Tuple
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.mock
import org.mockito.Mockito.never
import org.mockito.Mockito.verify
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.security.oauth2.jwt.JwtEncoder

class SessionServiceTest {
    private val members = mock(MemberRepository::class.java)
    private val sessions = mock(SessionRepository::class.java)
    private val tokens = mock(RefreshTokenRepository::class.java)
    private val passwords = BCryptPasswordEncoder(4)
    private val secrets = AuthTokenHelper()
    private val service = SessionService(members, sessions, tokens, passwords, secrets, mock(JwtEncoder::class.java))
    private val member = AuthMember(UUID.randomUUID(), "reader@example.test", requireNotNull(passwords.encode("password-123")), "Reader")

    private fun stored(token: String, session: AuthSession, used: Boolean = false) {
        val hash = secrets.hash(token)
        `when`(tokens.findMemberId(hash)).thenReturn(member.id)
        `when`(members.findById(member.id)).thenReturn(Optional.of(member))
        `when`(tokens.findById(hash)).thenReturn(Optional.of(AuthRefreshToken(hash, session.id, used)))
        `when`(sessions.findById(session.id)).thenReturn(Optional.of(session))
    }

    private fun session(revoked: Boolean = false, expiresAt: Instant = Instant.now().plusSeconds(3600)) =
        AuthSession(UUID.randomUUID(), member.id, "device", Instant.now(), expiresAt, revoked)

    @Test
    fun `verifying a live refresh cookie returns the member without rotating or revoking anything`() {
        stored("live-token", session())

        val verified = service.verifyRefreshToken("live-token")

        assertEquals(MemberResponse(member.id.toString(), member.email, member.nickname, member.operator), verified)
        verify(tokens, never()).save(any(AuthRefreshToken::class.java))
        verify(sessions, never()).revokeAll(member.id)
    }

    @Test
    fun `verifying refuses revoked, expired and already used tokens and never revokes sessions as replay detection does`() {
        stored("revoked-token", session(revoked = true))
        stored("expired-token", session(expiresAt = Instant.now().minusSeconds(1)))
        stored("used-token", session(), used = true)

        for (token in listOf("revoked-token", "expired-token", "used-token")) assertNull(service.verifyRefreshToken(token), token)

        verify(sessions, never()).revokeAll(member.id)
        verify(tokens, never()).save(any(AuthRefreshToken::class.java))
    }

    @Test
    fun `verifying refuses restricted members and missing, blank, overlong or unknown tokens`() {
        stored("restricted-token", session())
        member.restricted = true

        assertNull(service.verifyRefreshToken("restricted-token"))
        assertNull(service.verifyRefreshToken(null))
        assertNull(service.verifyRefreshToken("  "))
        assertNull(service.verifyRefreshToken("x".repeat(129)))
        assertNull(service.verifyRefreshToken("unknown-token"))
    }

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
        verify(tokens, never()).save(any(AuthRefreshToken::class.java))
    }
}
