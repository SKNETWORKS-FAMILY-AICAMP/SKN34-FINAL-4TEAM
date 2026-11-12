package ai.storyfork.core.auth

import ai.storyfork.core.auth.entity.AuthMember
import ai.storyfork.core.auth.helper.AuthTokenHelper
import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.repository.ProfileChallengeRepository
import ai.storyfork.core.auth.repository.SessionRepository
import ai.storyfork.core.auth.service.AuthException
import ai.storyfork.core.auth.service.ProfileService
import ai.storyfork.core.auth.service.dto.NicknameRequest
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.springframework.mail.javamail.JavaMailSender
import org.springframework.security.crypto.password.PasswordEncoder

/** 이용 제한(탈퇴 완료 포함) 회원은 이미 발급된 토큰이 있어도 프로필을 바꿀 수 없다. */
class ProfileServiceRestrictedTest {
    private val members = mock(MemberRepository::class.java)
    private val service = ProfileService(
        members, mock(ProfileChallengeRepository::class.java), mock(SessionRepository::class.java), mock(PasswordEncoder::class.java),
        mock(AuthTokenHelper::class.java), mock(JavaMailSender::class.java), "http://127.0.0.1:8088", "ci@example.invalid",
    )

    private fun member(restricted: Boolean) = AuthMember(UUID.randomUUID(), "a@example.invalid", "x", "Reader", restricted = restricted)

    @Test
    fun `a restricted member cannot change the nickname`() {
        val m = member(true)
        `when`(members.lockById(m.id)).thenReturn(m)
        val e = assertThrows(AuthException::class.java) { service.nickname(m.id, NicknameRequest("New")) }
        assertEquals(AuthException.Reason.UNAUTHENTICATED, e.reason)
        assertEquals("Reader", m.nickname)
    }

    @Test
    fun `an ordinary member still can`() {
        val m = member(false)
        `when`(members.lockById(m.id)).thenReturn(m)
        assertEquals("New", service.nickname(m.id, NicknameRequest(" New ")).nickname)
    }
}
