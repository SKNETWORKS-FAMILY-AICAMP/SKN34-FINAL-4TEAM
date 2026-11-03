package ai.storyfork.core.work.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "member")
class MemberEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "email")
    var email: String? = null,
    @field:Column(name = "password_hash")
    var passwordHash: String? = null,
    @field:Column(name = "nickname")
    var nickname: String? = null,
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
)
