package ai.storyfork.content.proposal.entity

import jakarta.persistence.*

@Entity
@Table(name="ai_run_event",uniqueConstraints=[UniqueConstraint(columnNames=["run_id","seq"]),
    UniqueConstraint(columnNames=["run_id","task_id","attempt","phase","step"])])
class AiRunEventEntity(
    @field:Id var id: String = "",
    @field:Column(name="run_id") var runId: String = "",
    @field:Column(name="seq") var seq: Long = 0,
    @field:Column(name="task_id") var taskId: String = "run",
    @field:Column(name="attempt") var attempt: Int = 1,
    @field:Column(name="phase") var phase: String = "run",
    @field:Column(name="step") var step: Int = 1,
    @field:Column(name="code") var code: String = "ANALYZING",
    @field:Column(name="status") var status: String = "pending",
)
