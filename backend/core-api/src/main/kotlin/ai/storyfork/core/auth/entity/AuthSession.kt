package ai.storyfork.core.auth.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "auth_session")
class AuthSession(
    @Id val id: UUID,
    @Column(name = "member_id", nullable = false) val memberId: UUID,
    @Column(name = "device_label", nullable = false, length = 200) val deviceLabel: String,
    @Column(name = "created_at", nullable = false) val createdAt: Instant,
    @Column(name = "expires_at", nullable = false) val expiresAt: Instant,
    @Column(nullable = false) var revoked: Boolean = false,
)
