package ai.storyfork.core.auth.repository

import ai.storyfork.core.auth.entity.AuthMember
import jakarta.persistence.LockModeType
import jakarta.persistence.Tuple
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query

interface MemberRepository : JpaRepository<AuthMember, UUID> {
    fun existsByEmail(email: String): Boolean

    // Scalar projection: do not populate the persistence context before the member lock.
    @Query("select m.id as id, m.passwordHash as passwordHash from AuthMember m where m.email = :email")
    fun findCredentialsByEmail(email: String): Tuple?

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select m from AuthMember m where m.id = :id")
    fun lockById(id: UUID): AuthMember?

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select m from AuthMember m where m.email = :email")
    fun lockByEmail(email: String): AuthMember?
}
