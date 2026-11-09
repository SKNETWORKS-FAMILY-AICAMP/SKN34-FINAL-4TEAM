package ai.storyfork.content.proposal.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name="ai_thread")
class AiThreadEntity(
    @field:Id @field:Column(name="id") var id: String = "",
    @field:Column(name="requester_id") var requesterId: String = "",
    @field:Column(name="work_id") var workId: String = "",
    @field:Column(name="fork_id") var forkId: String? = null,
    @field:Column(name="created_at") var createdAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
)
