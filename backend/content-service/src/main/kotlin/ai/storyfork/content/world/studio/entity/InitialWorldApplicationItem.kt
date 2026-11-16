package ai.storyfork.content.world.studio.entity

import jakarta.persistence.*
import java.util.UUID

/** 승인 순번과 한번 발급한 ID를 고정한다. 불확실한 결과의 예약은 해제하지 않는다. */
@Entity
@Table(name="initial_application_item", schema="worldstudio")
class InitialWorldApplicationItem(
    @Id val id: UUID = UUID.randomUUID(),
    @Column(name="world_id", nullable=false) val worldId: UUID,
    @Column(name="analysis_id", nullable=false) val analysisId: UUID,
    @Column(name="application_id", nullable=false) val applicationId: UUID,
    @Column(name="candidate_id", nullable=false) val candidateId: UUID,
    @Column(name="decision_sequence", nullable=false) val decisionSequence: Long,
    @Column(name="decision_state", nullable=false) val decisionState: String = "approved",
    @Column(name="generated_id", nullable=false) val generatedId: UUID,
    @Column(name="generated_kind", nullable=false) val generatedKind: String,
    @Column(nullable=false) var active: Boolean = true,
)
