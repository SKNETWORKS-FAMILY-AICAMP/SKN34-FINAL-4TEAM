package ai.storyfork.core.auth.repository

import ai.storyfork.core.auth.entity.AuthWithdrawal
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface WithdrawalRepository : JpaRepository<AuthWithdrawal, UUID> {
    fun findByMemberIdAndStatus(memberId: UUID, status: String): AuthWithdrawal?
}
