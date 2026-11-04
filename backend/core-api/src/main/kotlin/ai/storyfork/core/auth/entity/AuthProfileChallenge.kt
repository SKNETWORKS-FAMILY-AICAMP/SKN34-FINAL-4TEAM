package ai.storyfork.core.auth.entity

import jakarta.persistence.Column
import jakarta.persistence.Embeddable
import jakarta.persistence.EmbeddedId
import jakarta.persistence.Entity
import jakarta.persistence.Table
import java.io.Serializable
import java.time.Instant
import java.util.UUID
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes

@Embeddable
data class ProfileChallengeId(
    @Column(name = "member_id", nullable = false) val memberId: UUID,
    @Column(nullable = false, length = 20) val purpose: String,
) : Serializable

@Entity
@Table(name = "auth_profile_challenge")
class AuthProfileChallenge(
    @EmbeddedId val id: ProfileChallengeId,
    @Column(name = "target_email", length = 254) var targetEmail: String?,
    @JdbcTypeCode(SqlTypes.CHAR) @Column(name = "token_hash", nullable = false, unique = true, length = 64) var tokenHash: String,
    @Column(name = "expires_at", nullable = false) var expiresAt: Instant,
)
