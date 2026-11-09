package ai.storyfork.core.auth.repository

import ai.storyfork.core.auth.entity.AuthMember
import jakarta.persistence.LockModeType
import jakarta.persistence.Tuple
import java.util.UUID
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query

interface MemberRepository : JpaRepository<AuthMember, UUID> {
    fun existsByEmail(email: String): Boolean

    // Scalar projection: do not populate the persistence context before the member lock.
    @Query("select m.id as id, m.passwordHash as passwordHash from AuthMember m where m.email = :email")
    fun findCredentialsByEmail(email: String): Tuple?

    /** 운영 회원 목록. pattern은 소문자·LIKE 이스케이프(`!`)된 `%q%`다. 백슬래시 리터럴 해석 차이를 피하려고 `!`를 쓴다. */
    @Query("select m from AuthMember m where m.operator in :operators and " +
        "(lower(m.email) like :pattern escape '!' or lower(m.nickname) like :pattern escape '!')")
    fun search(operators: Collection<Boolean>, pattern: String, pageable: Pageable): List<AuthMember>

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select m from AuthMember m where m.id = :id")
    fun lockById(id: UUID): AuthMember?

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select m from AuthMember m where m.email = :email")
    fun lockByEmail(email: String): AuthMember?
}
