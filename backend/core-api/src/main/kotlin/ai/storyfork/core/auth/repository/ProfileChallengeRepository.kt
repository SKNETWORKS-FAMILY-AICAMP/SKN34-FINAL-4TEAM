package ai.storyfork.core.auth.repository

import ai.storyfork.core.auth.entity.AuthProfileChallenge
import ai.storyfork.core.auth.entity.ProfileChallengeId
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query

interface ProfileChallengeRepository : JpaRepository<AuthProfileChallenge, ProfileChallengeId> {
    @Query("select c.id.memberId from AuthProfileChallenge c where c.id.purpose = :purpose and c.tokenHash = :tokenHash")
    fun findMemberId(purpose: String, tokenHash: String): UUID?
}
