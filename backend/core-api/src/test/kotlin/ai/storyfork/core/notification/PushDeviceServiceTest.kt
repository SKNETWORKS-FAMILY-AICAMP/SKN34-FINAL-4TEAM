package ai.storyfork.core.notification

import ai.storyfork.core.auth.entity.AuthSession
import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.repository.SessionRepository
import ai.storyfork.core.notification.domain.NoticeKind
import ai.storyfork.core.notification.entity.NoticePreferenceEntity
import ai.storyfork.core.notification.entity.PushDevice
import ai.storyfork.core.notification.repository.NoticePreferenceRepository
import ai.storyfork.core.notification.repository.PushDeviceRepository
import ai.storyfork.core.notification.service.PushDeviceService
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.web.server.ResponseStatusException

class PushDeviceServiceTest {
    private val devices = mock(PushDeviceRepository::class.java)
    private val sessions = mock(SessionRepository::class.java)
    private val preferences = mock(NoticePreferenceRepository::class.java)
    private val service = PushDeviceService(devices, sessions, preferences, mock(MemberRepository::class.java))
    private val installation = UUID.randomUUID()
    private val member = UUID.randomUUID()
    private val session = AuthSession(UUID.randomUUID(), member, "Android", Instant.EPOCH, Instant.MAX)

    @Test
    fun `같은 설치의 새 FCM 토큰은 이전 토큰과 SNS 연결을 교체한다`() {
        val existing = PushDevice(installation, session.id, "old-token", "old-endpoint")
        `when`(sessions.findByIdAndMemberIdAndRevokedFalse(session.id, member)).thenReturn(session)
        `when`(devices.findById(installation)).thenReturn(Optional.of(existing))

        service.register(member, session.id, installation, "new-token")

        assertEquals("new-token", existing.token)
        assertNull(existing.endpointArn)

        val previousRegistration = existing.registrationId
        existing.endpointArn = "cached-endpoint"
        service.register(member, session.id, installation, "new-token")

        assertNull(existing.endpointArn)
        assertNotEquals(previousRegistration, existing.registrationId)
    }

    @Test
    fun `타인과 로그아웃한 세션은 기기를 등록할 수 없다`() {
        assertThrows(ResponseStatusException::class.java) {
            service.register(member, session.id, installation, "new-token")
        }
        verifyNoInteractions(devices)
    }

    @Test
    fun `끄기로 저장한 분류는 제외하고 필수 알림은 활성 세션에 보낸다`() {
        val active = PushDevice(installation, session.id, "valid-token")
        `when`(preferences.findAllByMemberId(member)).thenReturn(listOf(
            NoticePreferenceEntity(member, "reading", false),
            NoticePreferenceEntity(member, "credit", false),
        ))
        `when`(devices.findAllBySessionIdIn(listOf(session.id))).thenReturn(listOf(active))
        `when`(sessions.findAllByMemberIdAndRevokedFalseAndExpiresAtAfterOrderByCreatedAt(eq(member) ?: member, any(Instant::class.java) ?: Instant.EPOCH))
            .thenReturn(listOf(session))

        assertTrue(service.recipients(member, NoticeKind.READING).isEmpty())
        assertEquals(listOf(active), service.recipients(member, NoticeKind.CREDIT))
    }
}
