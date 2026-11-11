package ai.storyfork.core.auth.service

import ai.storyfork.core.auth.entity.AuthWithdrawal
import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.repository.ProfileChallengeRepository
import ai.storyfork.core.auth.repository.SessionRepository
import ai.storyfork.core.auth.repository.WithdrawalRepository
import java.time.Instant
import java.util.UUID
import org.springframework.data.domain.PageRequest
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * 유예 기한이 지난 탈퇴 요청을 Core 안에서 완료 처리한다(UC-22 A3).
 * 계정을 "탈퇴한 회원"으로 익명화하고 로그인·세션·진행 중인 확인 요청을 막는다.
 * 작품·세계관 숨김·삭제·익명화와 크레딧 정산은 콘텐츠 서비스 계약과 정책이 정해진 뒤 연결하므로 여기서 하지 않는다.
 */
@Service
class WithdrawalCompletionService(
    private val members: MemberRepository,
    private val withdrawals: WithdrawalRepository,
    private val sessions: SessionRepository,
    private val challenges: ProfileChallengeRepository,
    private val passwords: PasswordEncoder,
) {
    /** 기한이 지난 처리 대기 요청 id를 오래된 순으로 limit개 반환한다. */
    @Transactional(readOnly = true)
    fun dueIds(now: Instant, limit: Int): List<UUID> = withdrawals.findDueIds(now, PageRequest.of(0, limit))

    /**
     * 요청 하나를 완료 처리하고 처리했으면 true를 반환한다. 요청·복구와 같은 순서(회원 잠금 → 요청 확인)로 잠가
     * 그 사이에 복구된 요청이나 아직 기한이 안 된 요청은 건드리지 않고 false를 반환한다.
     * 탈퇴 사유는 정책이 정해지기 전이라 그대로 둔다.
     */
    @Transactional
    fun complete(withdrawalId: UUID, now: Instant): Boolean {
        val memberId = withdrawals.findMemberId(withdrawalId) ?: return false
        val member = members.lockById(memberId) ?: return false
        val withdrawal = withdrawals.findById(withdrawalId).orElse(null) ?: return false
        if (withdrawal.status != AuthWithdrawal.PENDING || withdrawal.dueAt.isAfter(now)) return false
        // 같은 이메일로 다시 가입할 수 있도록 원래 이메일을 비운다. 비밀번호는 아무도 모르는 값으로 바꿔 로그인을 막는다.
        member.email = "withdrawn-${member.id}@$ANONYMOUS_EMAIL_DOMAIN"
        member.nickname = ANONYMOUS_NICKNAME
        member.passwordHash = requireNotNull(passwords.encode(UUID.randomUUID().toString()))
        challenges.deleteAllByMemberId(member.id)
        sessions.revokeAll(member.id)
        withdrawal.status = AuthWithdrawal.COMPLETED
        withdrawal.completedAt = now
        return true
    }

    companion object {
        const val ANONYMOUS_NICKNAME = "탈퇴한 회원"
        const val ANONYMOUS_EMAIL_DOMAIN = "withdrawn.invalid"
    }
}
