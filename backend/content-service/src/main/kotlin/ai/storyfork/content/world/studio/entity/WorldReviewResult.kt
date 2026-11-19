package ai.storyfork.content.world.studio.entity

import jakarta.persistence.*
import java.time.Instant
import java.util.UUID
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes

/**
 * 세계관마다 하나뿐인 마지막 설정집 AI 검토 결과(V12)다. 성공한 검토가 같은 행을 덮어쓴다.
 * [result]는 검토 응답에서 시각을 뺀 본문(`basis` 포함)이고 시각은 [reviewedAt] 열이다.
 */
@Entity
@Table(name="world_review_result", schema="worldstudio")
class WorldReviewResult(
    @Id @Column(name="world_id") val worldId: UUID,
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition="jsonb", nullable=false) val result: Map<String,Any?>,
    @Column(name="reviewed_at", nullable=false) val reviewedAt: Instant,
)
