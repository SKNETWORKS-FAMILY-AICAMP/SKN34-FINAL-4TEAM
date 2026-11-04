package ai.storyfork.core.auth.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.util.UUID

@Entity
@Table(name = "auth_member")
class AuthMember(
    @Id val id: UUID,
    @Column(nullable = false, unique = true, length = 254) var email: String,
    @Column(name = "password_hash", nullable = false) var passwordHash: String,
    @Column(nullable = false, length = 80) var nickname: String,
    @Column(nullable = false) val operator: Boolean = false,
)
