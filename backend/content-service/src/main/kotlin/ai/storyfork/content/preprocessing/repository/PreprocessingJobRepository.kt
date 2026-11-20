package ai.storyfork.content.preprocessing.repository

import ai.storyfork.content.preprocessing.entity.PreprocessingJobEntity
import jakarta.persistence.LockModeType
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.*
import org.springframework.data.repository.query.Param

interface PreprocessingJobRepository : JpaRepository<PreprocessingJobEntity, String> {
    /** 작품의 가장 최근에 접수한 작업이다. 접수·소유자 화면·재실행 가능 여부가 모두 이 한 건을 기준으로 한다. */
    fun findFirstByWorkIdOrderByCreatedAtDesc(workId: String): PreprocessingJobEntity?

    fun findAllByStatus(status: String, pageable: Pageable): Page<PreprocessingJobEntity>

    @Query(value = """SELECT EXISTS (SELECT 1 FROM worldstudio.manuscript_build_job
        WHERE CAST(id AS text)=:id AND status='running' AND deadline<=now())""", nativeQuery = true)
    fun hasExpiredLease(@Param("id") id: String): Boolean

    @Modifying
    @Query(value = """UPDATE worldstudio.manuscript_build_job SET status='queued',execution_token=NULL,
        deadline=NULL,failure_code=NULL,lock_version=lock_version+1
        WHERE CAST(id AS text)=:id AND (status='failed' OR (status='running' AND deadline<=now()))""", nativeQuery = true)
    fun requeueSnapshot(@Param("id") id: String): Int

    /** 같은 ID 재실행은 최초 스냅샷의 회차만 쓴다. 최신 원고에서 누락분을 보충하지 않는다. */
    @Query(value = """SELECT CAST(ep.item->>'number' AS integer)
        FROM worldstudio.manuscript_build_job b
        CROSS JOIN LATERAL jsonb_array_elements(b.manifest->'episodes') WITH ORDINALITY ep(item,n)
        WHERE CAST(b.id AS text)=:id AND b.work_id=:work AND CAST(b.owner_subject AS text)=:member
        ORDER BY ep.n""", nativeQuery = true)
    fun frozenNumbers(@Param("id") id: String, @Param("work") work: String, @Param("member") member: String): List<Int>

    @Query(value = """SELECT EXISTS (SELECT 1 FROM worldstudio.manuscript_build_job
        WHERE work_id=:work AND request_key=:key)""", nativeQuery = true)
    fun requestKeyExists(@Param("work") work: String, @Param("key") key: String): Boolean

    /** 적재 예약이 있거나 옛 작업에서 적재 전 실패였음을 입증할 수 없으면 새 ID로 우회하지 않는다. */
    @Query(value = """SELECT EXISTS (
        SELECT 1 FROM preprocessing_job j
        JOIN work w ON w.id=j.work_id
        LEFT JOIN worldstudio.manuscript_build_job b ON CAST(b.id AS text)=j.id AND b.work_id=j.work_id
        WHERE j.work_id=:work AND j.status='failed' AND (
            b.status IN ('loading','unknown','completed')
            OR EXISTS (SELECT 1 FROM worldstudio.manuscript_build_load_step step WHERE step.job_id=b.id)
            OR (b.id IS NULL AND (
                NOT (COALESCE(j.failed_reason,'')='전처리 로직 미구현' AND j.done=0 AND j.total>0
                     OR COALESCE(j.failed_reason,'')='회차 추출에 실패했어요.' AND cardinality(j.failed_episodes)>0)
                OR EXISTS (
                    SELECT 1 FROM worldstudio.world target
                    WHERE target.id IN (j.world_id,w.world_studio_id) AND (
                        EXISTS (SELECT 1 FROM worldstudio.setting_card c WHERE c.world_id=target.id)
                        OR NOT EXISTS (SELECT 1 FROM worldstudio.relationship_state r
                                       WHERE r.world_id=target.id AND r.completed AND r.graph_version=0)
                    )
                )
                OR (j.world_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM worldstudio.world target WHERE target.id=j.world_id))
            ))
        )
    )""", nativeQuery = true)
    fun requiresLoadReview(@Param("work") work: String): Boolean

    /** 진행 보고와 재실행이 같은 작업을 동시에 바꾸지 않게 행을 잠가 읽는다. 트랜잭션 안에서만 부른다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select j from PreprocessingJobEntity j where j.id = :id")
    fun lock(@Param("id") id: String): PreprocessingJobEntity?
}
