package ai.storyfork.content.world.studio.entity

import jakarta.persistence.*
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.util.UUID

/** 최초 구축 입력은 불변. 완료 후 신규 회차를 이 작업에 추가하지 않는다. */
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
