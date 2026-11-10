package ai.storyfork.core.credit.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

/** 지급분에서 빠져나간 크레딧 장부 행. kind는 `spend`(사용 차감) 또는 `expire`(소멸)이다. */
@Entity
@Table(name = "credit_ledger_entry")
class CreditLedgerEntryEntity(
    @Id val id: UUID,
    @Column(name = "grant_id", nullable = false) val grantId: UUID,
    @Column(nullable = false, length = 20) val kind: String,
    @Column(nullable = false) val amount: BigDecimal,
    @Column(name = "operation_key", nullable = false, length = 100) val operationKey: String,
    @Column(name = "occurred_at", nullable = false) val occurredAt: Instant,
)
