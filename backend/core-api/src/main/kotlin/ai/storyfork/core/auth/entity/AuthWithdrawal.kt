package ai.storyfork.core.auth.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.util.UUID

/** 회원의 탈퇴 요청·유예·복구 상태. 콘텐츠 삭제·익명화 결과는 후속 계약에서 별도로 기록한다. */
@Entity
@Table(name = "auth_withdrawal")
class AuthWithdrawal(
    @Id val id: UUID,
    @Column(name = "member_id", nullable = false) val memberId: UUID,
    @Column(name = "requested_at", nullable = false) val requestedAt: Instant,
    @Column(name = "due_at", nullable = false) val dueAt: Instant,
    @Column(name = "restored_at") var restoredAt: Instant? = null,
    @Column(name = "completed_at") var completedAt: Instant? = null,
    @Column(length = 300) val reason: String? = null,
    @Column(nullable = false, length = 20) var status: String = PENDING,
) {
    companion object {
        const val PENDING = "PENDING"
        const val RESTORED = "RESTORED"
        const val COMPLETED = "COMPLETED"
    }
}
