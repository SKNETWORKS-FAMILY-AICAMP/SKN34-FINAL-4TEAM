package ai.storyfork.content.proposal.entity

import jakarta.persistence.*

/** 원고 transaction보다 먼저 키·payload를 고정하고 실패는 rollback 후 별도로 기록한다. */
@Entity
@Table(name="change_decision_attempt")
class ChangeDecisionAttemptEntity(
    @field:Id @field:Column(name="id") val id: String = "",
    @field:Column(name="work_id") val workId: String = "",
    @field:Column(name="actor_id") val actorId: String = "",
    @field:Column(name="key_hash") val keyHash: String = "",
    @field:Column(name="request_hash") val requestHash: String = "",
    @field:Column(name="status") var status: String = "pending",
    @field:Column(name="failure_status") var failureStatus: Int? = null,
    @field:Column(name="failure_reason") var failureReason: String? = null,
)
