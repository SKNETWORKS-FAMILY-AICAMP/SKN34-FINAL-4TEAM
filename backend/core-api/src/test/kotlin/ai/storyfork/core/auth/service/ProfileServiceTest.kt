package ai.storyfork.core.auth.service

import ai.storyfork.core.auth.entity.AuthMember
import ai.storyfork.core.auth.entity.AuthProfileChallenge
import ai.storyfork.core.auth.entity.ProfileChallengeId
import ai.storyfork.core.auth.helper.AuthTokenHelper
import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.repository.ProfileChallengeRepository
import ai.storyfork.core.auth.repository.SessionRepository
import ai.storyfork.core.auth.service.dto.ResetRequest
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.Mockito.inOrder
import org.mockito.Mockito.mock
import org.mockito.Mockito.verify
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.verifyNoMoreInteractions
import org.mockito.Mockito.`when`
import org.springframework.http.HttpStatus
import org.springframework.mail.javamail.JavaMailSender
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.web.server.ResponseStatusException

class ProfileServiceTest {
    private val members = mock(MemberRepository::class.java)
    private val challenges = mock(ProfileChallengeRepository::class.java)
    private val sessions = mock(SessionRepository::class.java)
    private val passwords = mock(PasswordEncoder::class.java)
    private val secrets = AuthTokenHelper()
    private val profiles = ProfileService(members, challenges, sessions, passwords, secrets,
        mock(JavaMailSender::class.java), "https://example.invalid", "dev@example.invalid")
    private val member = AuthMember(UUID.randomUUID(), "reader@example.invalid", "old-hash", "Reader")
    private val reset = AuthProfileChallenge(ProfileChallengeId(member.id, "reset"), member.email,
        secrets.hash("reset-token"), Instant.now().plusSeconds(3600))
    private val request = ResetRequest("reset-token", "new-password")

    private fun givenReset(challenge: AuthProfileChallenge? = reset) {
        `when`(challenges.findMemberId("reset", reset.tokenHash)).thenReturn(member.id)
        `when`(members.lockById(member.id)).thenReturn(member)
        `when`(challenges.findById(reset.id)).thenReturn(Optional.ofNullable(challenge))
    }

    @Test
    fun `password reset revokes the pending email change only for the recovered member`() {
        givenReset()
        val email = AuthProfileChallenge(ProfileChallengeId(member.id, "email"), "changed@example.invalid",
            secrets.hash("email-token"), Instant.now().plusSeconds(3600))
        `when`(challenges.findById(email.id)).thenReturn(Optional.of(email))
        `when`(passwords.encode(request.newPassword)).thenReturn("new-hash")

        profiles.resetPassword(request)

        assertEquals("new-hash", member.passwordHash)
        assertEquals("reader@example.invalid", member.email)
        val order = inOrder(members, challenges)
        order.verify(challenges).findMemberId("reset", reset.tokenHash)
        order.verify(members).lockById(member.id)
        order.verify(challenges).findById(reset.id)
        order.verify(challenges).delete(reset)
        order.verify(challenges).findById(email.id)
        order.verify(challenges).delete(email)
        verify(sessions).revokeAll(member.id)
        verifyNoMoreInteractions(members, challenges, sessions)
    }

    @Test
    fun `password reset succeeds without a pending email change`() {
        givenReset()
        `when`(challenges.findById(ProfileChallengeId(member.id, "email"))).thenReturn(Optional.empty())
        `when`(passwords.encode(request.newPassword)).thenReturn("new-hash")

        profiles.resetPassword(request)

        assertEquals("new-hash", member.passwordHash)
        verify(challenges).findMemberId("reset", reset.tokenHash)
        verify(challenges).findById(reset.id)
        verify(challenges).delete(reset)
        verify(challenges).findById(ProfileChallengeId(member.id, "email"))
        verify(sessions).revokeAll(member.id)
        verifyNoMoreInteractions(challenges, sessions)
    }

    @Test
    fun `unknown reset token preserves passwords sessions and email challenges`() {
        val error = assertThrows(ResponseStatusException::class.java) { profiles.resetPassword(request) }

        assertEquals(HttpStatus.BAD_REQUEST, error.statusCode)
        assertEquals("old-hash", member.passwordHash)
        verify(challenges).findMemberId("reset", reset.tokenHash)
        verifyNoMoreInteractions(challenges)
        verifyNoInteractions(members, passwords, sessions)
    }

    private fun assertRejectedResetPreservesAccount() {
        val error = assertThrows(ResponseStatusException::class.java) { profiles.resetPassword(request) }

        assertEquals(HttpStatus.BAD_REQUEST, error.statusCode)
        assertEquals("old-hash", member.passwordHash)
        assertEquals("reader@example.invalid", member.email)
        verify(challenges).findMemberId("reset", reset.tokenHash)
        verify(members).lockById(member.id)
        verify(challenges).findById(reset.id)
        verifyNoMoreInteractions(members, challenges)
        verifyNoInteractions(passwords, sessions)
    }

    @Test
    fun `expired reset preserves passwords sessions and email challenges`() {
        reset.expiresAt = Instant.now().minusSeconds(1)
        givenReset()

        assertRejectedResetPreservesAccount()
    }

    @Test
    fun `reset for an old address preserves passwords sessions and email challenges`() {
        reset.targetEmail = "previous@example.invalid"
        givenReset()

        assertRejectedResetPreservesAccount()
    }

    @Test
    fun `replaced reset preserves passwords sessions and email challenges`() {
        givenReset(AuthProfileChallenge(reset.id, member.email, secrets.hash("replacement-token"), reset.expiresAt))

        assertRejectedResetPreservesAccount()
    }

    @Test
    fun `removed reset preserves passwords sessions and email challenges`() {
        givenReset(null)

        assertRejectedResetPreservesAccount()
    }
}
