package ai.storyfork.content.proposal.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name="ai_run",uniqueConstraints=[UniqueConstraint(columnNames=["requester_id","work_id","operation","key_hash"])])
class AiRunEntity(
    @field:Id @field:Column(name="id") var id: String = "",
    @field:Column(name="thread_id") var threadId: String = "",
    @field:Column(name="requester_id") var requesterId: String = "",
    @field:Column(name="work_id") var workId: String = "",
    @field:Column(name="operation") var operation: String = "",
    @field:Column(name="key_hash") var keyHash: String = "",
    @field:Column(name="request_hash") var requestHash: String = "",
    @field:Column(name="scope_hash") var scopeHash: String = "",
    @field:Column(name="basis_episode") var basisEpisode: Int = 1,
    @field:Column(name="base_revision") var baseRevision: Int = 0,
    @field:Column(name="target_refs_json") var targetRefsJson: String = "[]",
    @field:Column(name="grant_expires_at") var grantExpiresAt: Instant = Instant.now(),
    @field:Column(name="character_name") var characterName: String = "",
    @field:Column(name="max_calls") var maxCalls: Int = 0,
    @field:Column(name="notice_version") var noticeVersion: String = "",
    @field:Column(name="status") var status: String = "pending",
    @field:Column(name="dispatch_status") var dispatchStatus: String = "pending",
    @field:Column(name="error_code") var errorCode: String? = null,
    @field:Column(name="created_at") var createdAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
)
