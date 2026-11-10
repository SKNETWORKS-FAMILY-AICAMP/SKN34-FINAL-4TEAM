package ai.storyfork.content.world.studio.entity

import jakarta.persistence.*
import java.time.Instant
import java.util.UUID
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes

/** 저장된 입력의 불변 사본과 실행 임대. 실행/복구 API는 후속 PR에서 연결한다. */
@Entity
@Table(name="initial_analysis", schema="worldstudio")
class InitialWorldAnalysis(
    @Id val id: UUID = UUID.randomUUID(),
    @Column(name="world_id", nullable=false) val worldId: UUID,
    @Column(name="request_key", nullable=false) val requestKey: String,
    @Column(name="request_hash", nullable=false) val requestHash: String,
    @Column(name="draft_revision", nullable=false) val draftRevision: Long,
    @Column(name="relationship_version", nullable=false) val relationshipVersion: Long,
    @Column(name="current_revision_id") val currentRevisionId: UUID? = null,
    @JdbcTypeCode(SqlTypes.JSON) @Column(name="input_snapshot", columnDefinition="jsonb", nullable=false) val inputSnapshot: Map<String,Any?>,
    @Column(name="execution_token", nullable=false) val executionToken: UUID = UUID.randomUUID(),
    @Column(nullable=false) val deadline: Instant,
    @Column(name="execution_status", nullable=false) var executionStatus: String = "running",
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition="jsonb") var output: Map<String,Any?>? = null,
    @Column(name="created_at", nullable=false) val createdAt: Instant = Instant.now(),
    @Version @Column(name="lock_version", nullable=false) var lockVersion: Long = 0,
)
