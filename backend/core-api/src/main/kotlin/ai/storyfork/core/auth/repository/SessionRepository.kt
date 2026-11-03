package ai.storyfork.core.auth.repository

import ai.storyfork.core.auth.entity.AuthSession
import java.time.Instant
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query

interface SessionRepository : JpaRepository<AuthSession, UUID> {
    fun findAllByMemberIdAndRevokedFalseAndExpiresAtAfterOrderByCreatedAt(memberId: UUID, now: Instant): List<AuthSession>
    fun findByIdAndMemberIdAndRevokedFalse(id: UUID, memberId: UUID): AuthSession?

    @Modifying
    @Query("update AuthSession s set s.revoked = true where s.memberId = :memberId")
    fun revokeAll(memberId: UUID): Int
}
