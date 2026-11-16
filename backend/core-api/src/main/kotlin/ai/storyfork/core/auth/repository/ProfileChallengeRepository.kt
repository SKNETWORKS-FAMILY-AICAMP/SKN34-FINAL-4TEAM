package ai.storyfork.core.auth.repository

import ai.storyfork.core.auth.entity.AuthProfileChallenge
import ai.storyfork.core.auth.entity.ProfileChallengeId
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query

interface ProfileChallengeRepository : JpaRepository<AuthProfileChallenge, ProfileChallengeId> {
    @Query("select c.id.memberId from AuthProfileChallenge c where c.id.purpose = :purpose and c.tokenHash = :tokenHash")
    fun findMemberId(purpose: String, tokenHash: String): UUID?

    /** 회원의 진행 중인 이메일·비밀번호 변경 확인 요청을 모두 지운다. */
    @Modifying
    @Query("delete from AuthProfileChallenge c where c.id.memberId = :memberId")
    fun deleteAllByMemberId(memberId: UUID): Int
}
