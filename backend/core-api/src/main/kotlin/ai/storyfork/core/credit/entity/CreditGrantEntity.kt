package ai.storyfork.core.credit.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

/** 회원에게 지급한 크레딧 한 건. 남은 양은 장부에서 산출하므로 이 행은 지급 시점 이후 바꾸지 않는다. */
@Entity
@Table(name = "credit_grant")
class CreditGrantEntity(
    @Id val id: UUID,
    @Column(name = "member_id", nullable = false) val memberId: UUID,
    @Column(nullable = false, length = 30) val kind: String,
    @Column(nullable = false) val amount: BigDecimal,
    @Column(name = "granted_at", nullable = false) val grantedAt: Instant,
    @Column(name = "expires_at", nullable = false) val expiresAt: Instant,
)
