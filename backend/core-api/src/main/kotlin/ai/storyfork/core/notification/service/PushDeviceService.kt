package ai.storyfork.core.notification.service

import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.repository.SessionRepository
import ai.storyfork.core.notification.domain.NoticeKind
import ai.storyfork.core.notification.entity.PushDevice
import ai.storyfork.core.notification.repository.NoticePreferenceRepository
import ai.storyfork.core.notification.repository.PushDeviceRepository
import java.time.Instant
import java.util.UUID
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.server.ResponseStatusException

@Service
class PushDeviceService(
    private val devices: PushDeviceRepository,
    private val sessions: SessionRepository,
    private val preferences: NoticePreferenceRepository,
    private val members: MemberRepository,
) {
    @Transactional
    fun register(memberId: UUID, sessionId: UUID, installationId: UUID, token: String) {
        members.lockById(memberId) // 로그아웃과 같은 회원 잠금 안에서 세션을 확인한다.
        val now = Instant.now()
        val session = sessions.findByIdAndMemberIdAndRevokedFalse(sessionId, memberId)
        if (session == null || !session.expiresAt.isAfter(now)) throw ResponseStatusException(HttpStatus.UNAUTHORIZED)
        val device = devices.findById(installationId).orElse(null)
        if (device == null) devices.save(PushDevice(installationId, sessionId, token))
        else {
            if (device.sessionId != sessionId) {
                val previous = sessions.findById(device.sessionId).orElse(null)
                if (previous != null && previous.memberId != memberId && !previous.revoked && previous.expiresAt.isAfter(now)) {
                    throw ResponseStatusException(HttpStatus.CONFLICT)
                }
            }
            // 재등록은 FCM의 최신 토큰을 확인한 요청이므로 SNS 상태를 다음 발송에서 다시 읽는다.
            device.endpointArn = null
            device.sessionId = sessionId
            device.token = token
        }
    }

    @Transactional
    fun remove(memberId: UUID, installationId: UUID) {
        devices.deleteForMember(installationId, memberId)
    }

    @Transactional
    fun recipients(memberId: UUID, kind: NoticeKind): List<PushDevice> {
        if (kind.mutable && preferences.findAllByMemberId(memberId).any { it.kind == kind.code && !it.enabled }) return emptyList()
        val now = Instant.now()
        devices.deleteInactive(now)
        val sessionIds = sessions.findAllByMemberIdAndRevokedFalseAndExpiresAtAfterOrderByCreatedAt(memberId, now).map { it.id }
        return if (sessionIds.isEmpty()) emptyList() else devices.findAllBySessionIdIn(sessionIds).distinctBy { it.token }
    }

    @Transactional(readOnly = true)
    fun isActive(device: PushDevice) = devices.isActive(device.installationId, device.sessionId, device.token, Instant.now())

    @Transactional
    fun saveEndpoint(device: PushDevice, endpoint: String?) =
        devices.saveEndpoint(device.installationId, device.sessionId, device.token, endpoint) == 1

    @Transactional
    fun removeInvalid(device: PushDevice) {
        devices.deleteMatching(device.installationId, device.sessionId, device.token)
    }
}
