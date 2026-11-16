package ai.storyfork.core.credit.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

/** AI 작업 한 건을 위해 상한만큼 미리 잡아 둔 크레딧. 정산(SETTLED) 또는 해제(RELEASED)로만 끝난다. */
@Entity
@Table(name = "credit_reservation")
class CreditReservationEntity(
    @Id val id: UUID,
    @Column(name = "member_id", nullable = false) val memberId: UUID,
    @Column(name = "operation_key", nullable = false, length = 100) val operationKey: String,
    @Column(nullable = false) val amount: BigDecimal,
    @Column(nullable = false, length = 20) var status: String = RESERVED,
    @Column(name = "settled_amount") var settledAmount: BigDecimal? = null,
    @Column(name = "reserved_at", nullable = false) val reservedAt: Instant,
    @Column(name = "resolved_at") var resolvedAt: Instant? = null,
) {
    companion object {
        const val RESERVED = "RESERVED"
        const val SETTLED = "SETTLED"
        const val RELEASED = "RELEASED"
    }
}
