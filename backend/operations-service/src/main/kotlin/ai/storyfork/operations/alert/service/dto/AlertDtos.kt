package ai.storyfork.operations.alert.service.dto

import java.time.Instant
import java.util.UUID

data class AlertResponse(
    val id: UUID,
    val ruleKey: String,
    val status: String,
    val message: String,
    val value: Double?,
    val targetRef: String?,
    val createdAt: Instant,
    val actedBy: UUID?,
    val actedAt: Instant?,
    val note: String?,
)

data class AlertListResponse(val items: List<AlertResponse>)

/** [status] is the state to move to: acknowledged or resolved. */
data class AlertActRequest(val status: String, val note: String? = null)

data class AlertRuleResponse(
    val key: String,
    val metric: String,
    val threshold: Double?,
    val windowMinutes: Int,
    val enabled: Boolean,
    val updatedAt: Instant,
)

data class AlertRuleListResponse(val items: List<AlertRuleResponse>)

data class AlertRuleRequest(val threshold: Double? = null, val windowMinutes: Int, val enabled: Boolean)
