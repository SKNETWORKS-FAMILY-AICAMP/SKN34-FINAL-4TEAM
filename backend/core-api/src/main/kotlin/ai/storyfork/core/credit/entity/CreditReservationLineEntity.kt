package ai.storyfork.core.credit.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.math.BigDecimal
import java.util.UUID

/** 예약이 어느 지급분에서 얼마를 잡고 있는지. 예약이 끝나면 지운다. */
@Entity
@Table(name = "credit_reservation_line")
class CreditReservationLineEntity(
    @Id val id: UUID,
    @Column(name = "reservation_id", nullable = false) val reservationId: UUID,
    @Column(name = "grant_id", nullable = false) val grantId: UUID,
    @Column(nullable = false) val amount: BigDecimal,
)
