package ai.storyfork.core.auth.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.util.UUID

/** 회원 정본. `operator=true`는 운영 관리자(ADMIN), `restricted=true`는 운영 이용 제한 회원이다. */
@Entity
@Table(name = "auth_member")
class AuthMember(
    @Id val id: UUID,
    @Column(nullable = false, unique = true, length = 254) var email: String,
    @Column(name = "password_hash", nullable = false) var passwordHash: String,
    @Column(nullable = false, length = 80) var nickname: String,
    @Column(nullable = false) val operator: Boolean = false,
    @Column(name = "created_at", nullable = false, updatable = false) val createdAt: Instant = Instant.now(),
    @Column(nullable = false) var restricted: Boolean = false,
)
