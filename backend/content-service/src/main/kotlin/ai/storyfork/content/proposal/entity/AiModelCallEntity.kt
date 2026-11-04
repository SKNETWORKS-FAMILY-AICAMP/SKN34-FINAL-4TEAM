package ai.storyfork.content.proposal.entity

import jakarta.persistence.*
import java.time.Instant
import java.math.BigDecimal

@Entity
@Table(name = "ai_model_call")
class AiModelCallEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "job_id")
    var jobId: String = "",
    @field:Column(name = "sequence")
    var sequence: Int = 0,
    @field:Column(name = "role")
    var role: String = "",
    @field:Column(name = "provider")
    var provider: String = "",
    @field:Column(name = "model")
    var model: String? = null,
    @field:Column(name = "trace_ref")
    var traceRef: String? = null,
    @field:Column(name = "status")
    var status: String = "",
    @field:Column(name = "usage_status")
    var usageStatus: String = "",
    @field:Column(name = "input_tokens")
    var inputTokens: Int? = null,
    @field:Column(name = "output_tokens")
    var outputTokens: Int? = null,
    @field:Column(name = "provider_cost")
    var providerCost: BigDecimal? = null,
    @field:Column(name = "started_at")
    var startedAt: Instant? = null,
    @field:Column(name = "finished_at")
    var finishedAt: Instant? = null,
    @field:Column(name = "failure_code")
    var failureCode: String? = null,
)
