package ai.storyfork.content.world.studio.entity

import jakarta.persistence.*
import java.time.Instant
import java.util.UUID
import org.hibernate.annotations.Immutable
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes

/** Content 발급 UUID와 AI localRef 매핑. 원본 근거는 검토 수정본으로 덮어쓰지 않는다. */
@Entity
@Immutable
@Table(name="initial_candidate", schema="worldstudio")
class InitialWorldCandidate(
    @Id val id: UUID = UUID.randomUUID(),
    @Column(name="world_id", nullable=false) val worldId: UUID,
    @Column(name="analysis_id", nullable=false) val analysisId: UUID,
    @Column(name="local_ref", nullable=false) val localRef: String,
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition="jsonb", nullable=false) val content: Map<String,Any?>,
    @Column(name="created_at", nullable=false) val createdAt: Instant = Instant.now(),
)
