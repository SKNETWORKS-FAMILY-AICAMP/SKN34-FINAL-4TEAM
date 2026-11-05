package ai.storyfork.core.auth.repository

import ai.storyfork.core.auth.entity.AuthRefreshToken
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query

interface RefreshTokenRepository : JpaRepository<AuthRefreshToken, String> {
    @Query("select s.memberId from AuthRefreshToken t, AuthSession s where t.sessionId = s.id and t.tokenHash = :tokenHash")
    fun findMemberId(tokenHash: String): UUID?
}
