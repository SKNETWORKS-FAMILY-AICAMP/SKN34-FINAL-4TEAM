package ai.storyfork.core.auth.service

import ai.storyfork.core.auth.entity.AuthWithdrawal
import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.repository.SessionRepository
import ai.storyfork.core.auth.repository.WithdrawalRepository
import ai.storyfork.core.auth.service.dto.WithdrawalRequest
import ai.storyfork.core.auth.service.dto.WithdrawalResponse
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * 회원 탈퇴 요청과 30일 유예 중 복구를 관리한다(UC-22 A3).
 * 이 서비스는 Core의 계정·세션·유예 상태만 소유한다. 작품·세계관 숨김·삭제·익명화와 크레딧 정산은
 * 콘텐츠 서비스 계약이 정해진 뒤 후속으로 연결하며, 유예 만료 후 실제 처리는 아직 하지 않는다.
 */
@Service
class WithdrawalService(
    private val members: MemberRepository,
    private val withdrawals: WithdrawalRepository,
    private val sessions: SessionRepository,
    private val passwords: PasswordEncoder,
) {
    /** 비밀번호를 확인한 뒤 유예 요청을 만들고 모든 refresh 세션을 폐기한다. 이미 진행 중이면 409, 비밀번호가 다르면 403이다. */
    @Transactional
    fun request(memberId: UUID, request: WithdrawalRequest): WithdrawalResponse {
        val member = members.lockById(memberId) ?: throw AuthException(AuthException.Reason.UNAUTHENTICATED)
        if (!passwords.matches(request.password, member.passwordHash)) throw AuthException(AuthException.Reason.FORBIDDEN)
        if (withdrawals.findByMemberIdAndStatus(memberId, AuthWithdrawal.PENDING) != null) throw AuthException(AuthException.Reason.CONFLICT)
        val now = Instant.now().truncatedTo(ChronoUnit.MICROS)
        val saved = withdrawals.save(AuthWithdrawal(
            id = UUID.randomUUID(), memberId = memberId, requestedAt = now, dueAt = now.plus(GRACE_DAYS, ChronoUnit.DAYS),
            reason = request.reason?.trim()?.takeIf { it.isNotEmpty() },
        ))
        sessions.revokeAll(memberId)
        return toResponse(saved)
    }

    /** 진행 중인 요청이 있으면 PENDING과 시각을, 없으면 NONE을 반환한다. */
    @Transactional(readOnly = true)
    fun status(memberId: UUID): WithdrawalResponse =
        withdrawals.findByMemberIdAndStatus(memberId, AuthWithdrawal.PENDING)?.let(::toResponse) ?: WithdrawalResponse(NONE, null, null)

    /** 유예 중인 요청을 취소(복구)한다. 진행 중인 요청이 없으면 404, 유예 기한이 지난 요청은 복구할 수 없어 409다. */
    @Transactional
    fun restore(memberId: UUID) {
        members.lockById(memberId) ?: throw AuthException(AuthException.Reason.UNAUTHENTICATED)
        val pending = withdrawals.findByMemberIdAndStatus(memberId, AuthWithdrawal.PENDING) ?: throw AuthException(AuthException.Reason.NOT_FOUND)
        val now = Instant.now()
        // 유예 만료 후 실제 처리는 아직 없어 행이 PENDING으로 남을 수 있다. 기한이 지났으면 복구를 허용하지 않는다.
        if (!now.isBefore(pending.dueAt)) throw AuthException(AuthException.Reason.CONFLICT)
        pending.status = AuthWithdrawal.RESTORED
        pending.restoredAt = now
    }

    private fun toResponse(w: AuthWithdrawal) = WithdrawalResponse(w.status, w.requestedAt, w.dueAt)

    companion object {
        const val GRACE_DAYS = 30L
        const val NONE = "NONE"
    }
}
