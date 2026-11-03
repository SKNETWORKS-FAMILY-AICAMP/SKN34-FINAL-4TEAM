package ai.storyfork.core.auth.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.util.UUID
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes

@Entity
@Table(name = "auth_refresh_token")
class AuthRefreshToken(
    @Id @JdbcTypeCode(SqlTypes.CHAR) @Column(name = "token_hash", length = 64) val tokenHash: String,
    @Column(name = "session_id", nullable = false) val sessionId: UUID,
    @Column(nullable = false) var used: Boolean = false,
)
