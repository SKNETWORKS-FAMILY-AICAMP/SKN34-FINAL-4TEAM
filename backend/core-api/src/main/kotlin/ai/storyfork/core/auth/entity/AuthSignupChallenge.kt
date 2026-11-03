package ai.storyfork.core.auth.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes

@Entity
@Table(name = "auth_signup_challenge")
class AuthSignupChallenge(
    @Id @Column(length = 254) val email: String,
    @Column(name = "password_hash", nullable = false) var passwordHash: String,
    @Column(nullable = false, length = 80) var nickname: String,
    @JdbcTypeCode(SqlTypes.CHAR) @Column(name = "token_hash", nullable = false, unique = true, length = 64) var tokenHash: String,
    @Column(name = "expires_at", nullable = false) var expiresAt: Instant,
)
