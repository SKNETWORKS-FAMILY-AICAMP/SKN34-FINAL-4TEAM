package ai.storyfork.content.world.studio.entity

import jakarta.persistence.*
import java.time.Instant
import java.util.UUID
import org.hibernate.annotations.Immutable
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes

/** 순번별 불변 검토 기록. 수정은 pending이며 원래 AI 근거를 수정본의 증명으로 사용하지 않는다. */
@Entity
@Immutable
@Table(name="initial_decision", schema="worldstudio")
class InitialWorldDecision(
    @Id val id: UUID = UUID.randomUUID(),
    @Column(name="world_id", nullable=false) val worldId: UUID,
    @Column(name="analysis_id", nullable=false) val analysisId: UUID,
    @Column(name="candidate_id", nullable=false) val candidateId: UUID,
    @Column(nullable=false) val sequence: Long,
    @Column(nullable=false) val action: String,
    @Column(name="actor_id", nullable=false) val actorId: UUID,
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition="jsonb", nullable=false) val content: Map<String,Any?>,
    @Column(name="created_at", nullable=false) val createdAt: Instant = Instant.now(),
) {
    @Column(nullable=false)
    val state: String = when(action) {
        "approve" -> "approved"
        "edit" -> "pending"
        "hold" -> "held"
        "reject" -> "rejected"
        else -> throw IllegalArgumentException("지원하지 않는 검토 동작입니다.")
    }
    init {
        require(sequence>0)
        val provenance=content["provenance"]
        require(provenance in setOf("ai_extraction","author_revision","author_addition"))
        val evidence=content["evidence"] as? List<*> ?: throw IllegalArgumentException("근거 배열이 필요합니다.")
        require(if(provenance=="ai_extraction") evidence.isNotEmpty() else evidence.isEmpty())
        require(action!="edit" || provenance=="author_revision")
    }
}
