package ai.storyfork.operations.alert.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.Version
import java.math.BigDecimal
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

/** Alert statuses as stored (lowercase, as in the contract); a resolved alert never reopens. */
object AlertStatus {
    const val OPEN = "open"
    const val ACKNOWLEDGED = "acknowledged"
    const val RESOLVED = "resolved"
    val ALL = setOf(OPEN, ACKNOWLEDGED, RESOLVED)
}

/** A seeded rule: an admin changes only the threshold, window and switch, never the key or metric. */
@Entity
@Table(name = "alert_rule", schema = "operations")
class AlertRuleEntity(
    @field:Id
    @field:Column(name = "key", nullable = false, updatable = false, length = 40)
    val ruleKey: String,
    @field:Column(nullable = false, updatable = false, length = 40)
    val metric: String,
    @field:Column
    var threshold: BigDecimal? = null,
    @field:Column(name = "window_minutes", nullable = false)
    var windowMinutes: Int,
    @field:Column(nullable = false)
    var enabled: Boolean = false,
    @field:Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
)

/** Versioned: when two admins handle one alert at once, the later save is refused (409) instead of overwriting the other's decision. */
@Entity
@Table(name = "operation_alert", schema = "operations")
class OperationAlertEntity(
    @field:Id
    @field:Column(nullable = false, updatable = false)
    val id: UUID = UUID.randomUUID(),
    @field:Column(name = "rule_key", nullable = false, updatable = false, length = 40)
    val ruleKey: String,
    @field:Column(nullable = false, length = 20)
    var status: String = AlertStatus.OPEN,
    @field:Column(nullable = false, updatable = false, length = 500)
    val message: String,
    @field:Column(updatable = false)
    val value: BigDecimal? = null,
    @field:Column(name = "target_ref", updatable = false, length = 100)
    val targetRef: String? = null,
    @field:Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant = Instant.now().truncatedTo(ChronoUnit.MICROS),
    @field:Column(name = "acted_by")
    var actedBy: UUID? = null,
    @field:Column(name = "acted_at")
    var actedAt: Instant? = null,
    @field:Column(length = 500)
    var note: String? = null,
    @field:Version
    @field:Column(nullable = false)
    var version: Long? = null,
)
