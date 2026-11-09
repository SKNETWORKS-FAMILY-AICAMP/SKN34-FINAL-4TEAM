package ai.storyfork.content.world.studio.entity

import jakarta.persistence.*
import java.time.Instant
import java.util.UUID
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes

/** 추가 payload와 요청 식별자는 준비 시 고정. 실제 초안 반영과 완료 receipt의 원자적 연결은 후속 PR이다. */
@Entity
@Table(name="initial_application", schema="worldstudio")
class InitialWorldApplication(
    @Id val id: UUID = UUID.randomUUID(),
    @Column(name="world_id", nullable=false) val worldId: UUID,
    @Column(name="analysis_id", nullable=false) val analysisId: UUID,
    @Column(name="request_key", nullable=false) val requestKey: String,
    @Column(name="request_hash", nullable=false) val requestHash: String,
    @Column(name="base_draft_revision", nullable=false) val baseDraftRevision: Long,
    @Column(name="relationship_version", nullable=false) val relationshipVersion: Long,
    @JdbcTypeCode(SqlTypes.JSON) @Column(name="addition_payload", columnDefinition="jsonb", nullable=false) val additionPayload: Map<String,Any?>,
    @Column(nullable=false) var status: String = "applying",
    @Column(name="result_draft_revision") var resultDraftRevision: Long? = null,
    @Column(name="created_at", nullable=false) val createdAt: Instant = Instant.now(),
    @Version @Column(name="lock_version", nullable=false) var lockVersion: Long = 0,
)
