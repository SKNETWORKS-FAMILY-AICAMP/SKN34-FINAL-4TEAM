package ai.storyfork.core.auth.repository

import ai.storyfork.core.auth.entity.AuthSignupChallenge
import jakarta.persistence.LockModeType
import java.time.Instant
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query

interface SignupChallengeRepository : JpaRepository<AuthSignupChallenge, String> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from AuthSignupChallenge c where c.email = :email")
    fun lockByEmail(email: String): AuthSignupChallenge?

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    fun findByTokenHashAndExpiresAtAfter(tokenHash: String, now: Instant): AuthSignupChallenge?
}
