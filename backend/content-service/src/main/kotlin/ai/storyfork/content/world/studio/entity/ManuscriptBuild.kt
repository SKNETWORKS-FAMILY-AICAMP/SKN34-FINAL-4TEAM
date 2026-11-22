package ai.storyfork.content.world.studio.entity

import jakarta.persistence.*
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.util.UUID

/**
 * 작업 입력(manifest)은 불변이다. 완료 후 신규 회차를 이 작업에 추가하지 않는다.
 * [kind]가 update인 작업은 발행 회차를 세계관 초안에 더하고(2026-11-22) 기준 초안을 접수 때가 아니라 claim 때 [basis]에 고정한다.
 */
@Entity @Table(name="manuscript_build_job",schema="worldstudio")
class ManuscriptBuildJob(
    @Id val id:UUID=UUID.randomUUID(),
    @Column(name="work_id",nullable=false) val workId:String,
    @Column(name="world_id",nullable=false) val worldId:UUID,
    @Column(name="owner_subject",nullable=false) val ownerSubject:UUID,
    @Column(name="request_key",nullable=false) val requestKey:String,
    @Column(name="request_hash",nullable=false) val requestHash:String,
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition="jsonb",nullable=false) val manifest:Map<String,Any?>,
    @Column(nullable=false) var status:String="queued",
    @Column(name="execution_token") var executionToken:UUID?=null,
    var deadline:Instant?=null,
    @Column(name="failure_code") var failureCode:String?=null,
    @Column(name="created_at",nullable=false) val createdAt:Instant=Instant.now(),
    @Version @Column(name="lock_version",nullable=false) var lockVersion:Long=0,
    /** initial: 빈 세계관의 최초 구축, update: 발행 회차를 세계관 초안에 더하는 작업. */
    @Column(name="kind",nullable=false) val kind:String="initial",
    /** update 작업의 기준 초안(claim 때 고정). initial은 null이고 manifest.basis를 쓴다. */
    @JdbcTypeCode(SqlTypes.JSON) @Column(name="basis",columnDefinition="jsonb") var basis:Map<String,Any?>?=null,
)

/** 성공 결과를 덮어쓰지 않고 같은 슬롯/hash 응답만 재사용한다. */
@Entity @Table(name="manuscript_build_result",schema="worldstudio")
class ManuscriptBuildResult(
    @Id val id:UUID=UUID.randomUUID(),
    @Column(name="job_id",nullable=false) val jobId:UUID,
    @Column(nullable=false) val kind:String,
    @Column(nullable=false) val episode:Int,
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition="jsonb",nullable=false) val content:Map<String,Any?>,
    @Column(name="content_hash",nullable=false) val contentHash:String,
    @Column(name="created_at",nullable=false) val createdAt:Instant=Instant.now(),
)

/** UUID/key를 포함한 실제 저장 요청. receipt는 카드 저장과 같은 PG transaction에서 쓴다. */
@Entity @Table(name="manuscript_build_load_step",schema="worldstudio")
class ManuscriptBuildLoadStep(
    @Id val id:UUID=UUID.randomUUID(),
    @Column(name="job_id",nullable=false) val jobId:UUID,
    @Column(nullable=false) val sequence:Int,
    @JdbcTypeCode(SqlTypes.JSON) @Column(name="request_payload",columnDefinition="jsonb",nullable=false) val requestPayload:Map<String,Any?>,
    @Column(name="request_hash",nullable=false) val requestHash:String,
    @Column(nullable=false) var status:String="prepared",
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition="jsonb") var receipt:Map<String,Any?>?=null,
    @Version @Column(name="lock_version",nullable=false) var lockVersion:Long=0,
)
