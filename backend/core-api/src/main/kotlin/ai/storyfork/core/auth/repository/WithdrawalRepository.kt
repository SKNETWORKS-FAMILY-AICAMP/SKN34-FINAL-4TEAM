package ai.storyfork.core.auth.repository

import ai.storyfork.core.auth.entity.AuthWithdrawal
import java.time.Instant
import java.util.UUID
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query

interface WithdrawalRepository : JpaRepository<AuthWithdrawal, UUID> {
    fun findByMemberIdAndStatus(memberId: UUID, status: String): AuthWithdrawal?

    /** 유예 기한이 지났는데 아직 처리되지 않은 요청 id를 기한이 오래된 순으로 반환한다. */
    @Query("select w.id from AuthWithdrawal w where w.status = 'PENDING' and w.dueAt <= :now order by w.dueAt")
    fun findDueIds(now: Instant, pageable: Pageable): List<UUID>

    // Scalar projection: do not populate the persistence context before the member lock.
    @Query("select w.memberId from AuthWithdrawal w where w.id = :id")
    fun findMemberId(id: UUID): UUID?
}
