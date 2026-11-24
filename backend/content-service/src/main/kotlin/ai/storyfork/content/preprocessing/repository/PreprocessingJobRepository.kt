package ai.storyfork.content.preprocessing.repository

import ai.storyfork.content.preprocessing.entity.PreprocessingJobEntity
import ai.storyfork.content.world.studio.entity.ManuscriptBuildJob
import jakarta.persistence.LockModeType
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.*
import org.springframework.data.repository.query.Param
import java.util.UUID

interface PreprocessingJobRepository : JpaRepository<PreprocessingJobEntity, String> {
    /**
     * 작품의 가장 최근에 접수한 [kind] 종류의 작업이다. 최초 구축의 접수·소유자 화면·재실행 가능 여부는 initial의 이 한 건을,
     * 업데이트의 화면 표시·재실행 가능 여부는 update의 이 한 건을 기준으로 한다.
     */
    fun findFirstByWorkIdAndKindOrderByCreatedAtDesc(workId: String, kind: String): PreprocessingJobEntity?

    fun findFirstByWorkIdAndKindAndStatusInOrderByCreatedAtDesc(
        workId: String, kind: String, statuses: Collection<String>,
    ): PreprocessingJobEntity?

    /**
     * 운영 목록의 출처다. V15 작업 행(manuscript_build_job)이 있는 작업의 V41 행만 돌려준다(작업 행은 원고 본문이 든 manifest를 가져서 목록에서 읽지 않는다).
     * 쪽·정렬(최신 접수 순)은 [pageable]이 정한다.
     */
    @Query("""select j from PreprocessingJobEntity j join ManuscriptBuildJob b on cast(b.id as String)=j.id""")
    fun snapshots(pageable: Pageable): Page<PreprocessingJobEntity>

    @Query("""select j from PreprocessingJobEntity j join ManuscriptBuildJob b on cast(b.id as String)=j.id
        where b.status in :statuses""")
    fun snapshotsByStatus(@Param("statuses") statuses: Collection<String>, pageable: Pageable): Page<PreprocessingJobEntity>

    @Query("""select count(b) > 0 from ManuscriptBuildJob b
        where cast(b.id as String)=:id and b.status='running' and b.deadline<=instant""")
    fun hasExpiredLease(@Param("id") id: String): Boolean

    @Modifying
    @Query("""update versioned ManuscriptBuildJob b set b.status='queued', b.executionToken=null,
        b.deadline=null, b.failureCode=null where cast(b.id as String)=:id
        and (b.status='failed' or (b.status='running' and b.deadline<=instant))""")
    fun requeueSnapshot(@Param("id") id: String): Int

    @Query("""select b from ManuscriptBuildJob b where cast(b.id as String)=:id
        and b.workId=:work and cast(b.ownerSubject as String)=:member""")
    fun snapshot(@Param("id") id: String, @Param("work") work: String, @Param("member") member: String): ManuscriptBuildJob?

    fun frozenNumbers(id: String, work: String, member: String): List<Int> {
        val row = snapshot(id, work, member) ?: return emptyList()
        return manifestNumbers(row)
    }

    /** 세계관에 끝나지 않은 구축 작업(V15 queued·running·loading·unknown)이 있는가. 업데이트 접수 조건이다. */
    @Query("select count(b) > 0 from ManuscriptBuildJob b where b.worldId=:world and b.status in ('queued','running','loading','unknown')")
    fun openOn(@Param("world") world: UUID): Boolean

    @Query("select b from ManuscriptBuildJob b where b.workId=:work and b.status='completed'")
    fun completedBuilds(@Param("work") work: String): List<ManuscriptBuildJob>

    /**
     * 이미 세계관 초안에 반영된 회차 번호다: 끝난(completed) 작업 manifest에 들어 있던 번호의 합집합이다.
     * ponytail: manifest(원고 본문 포함)를 통째로 읽어 번호만 쓴다. 회차가 수백 개로 늘어 첫 발행 점검이 느려지면 manifest 번호만 뽑는 쿼리로 바꾼다.
     */
    fun reflectedNumbers(work: String): Set<Int> = completedBuilds(work).flatMapTo(mutableSetOf()) { manifestNumbers(it) }

    @Query("select b from ManuscriptBuildJob b where b.workId=:work and b.worldId=:world and b.kind='update' and b.status='failed'")
    fun failedUpdates(@Param("work") work: String, @Param("world") world: UUID): List<ManuscriptBuildJob>

    /** 실패한 업데이트는 manifest 전체가 미반영이다. 자동 접수는 건너뛰고 운영이 원래 작업을 재실행한다. */
    fun failedUpdateNumbers(work: String, world: UUID): Set<Int> =
        failedUpdates(work, world).flatMapTo(mutableSetOf()) { manifestNumbers(it) }

    @Query("select count(b)>0 from ManuscriptBuildJob b where b.workId=:work and b.requestKey=:key")
    fun requestKeyExists(@Param("work") work: String, @Param("key") key: String): Boolean

    /** 실패한 모든 작업의 적재 예약 및 구형 작업의 세계관 상태를 확인한다. */
    @Query("""select count(j)>0 from PreprocessingJobEntity j join WorkEntity w on w.id=j.workId
        left join ManuscriptBuildJob b on cast(b.id as String)=j.id and b.workId=j.workId
        where j.workId=:work and j.status='failed' and (
            b.status in ('loading','unknown','completed')
            or exists (select step.id from ManuscriptBuildLoadStep step where step.jobId=b.id)
            or (b.id is null and (
                not (coalesce(j.failedReason,'')='전처리 로직 미구현' and j.done=0 and j.total>0
                     or coalesce(j.failedReason,'')='회차 추출에 실패했어요.' and array_length(j.failedEpisodes)>0)
                or exists (select target.id from StudioWorld target
                    where (target.id=j.worldId or target.id=w.worldStudioId) and (
                        exists (select c.id from SettingCard c where c.worldId=target.id)
                        or not exists (select r.worldId from WorldRelationshipState r where r.worldId=target.id
                                       and r.completed=true and r.graphVersion=0)))
                or (j.worldId is not null and not exists (select t.id from StudioWorld t where t.id=j.worldId))
            ))
        )""")
    fun requiresLoadReview(@Param("work") work: String): Boolean

    /** 진행 보고와 재실행이 같은 작업을 동시에 바꾸지 않게 행을 잠가 읽는다. 트랜잭션 안에서만 부른다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select j from PreprocessingJobEntity j where j.id = :id")
    fun lock(@Param("id") id: String): PreprocessingJobEntity?
}

private fun manifestNumbers(row: ManuscriptBuildJob): List<Int> =
    (row.manifest.getValue("episodes") as List<*>).map { ((it as Map<*, *>)["number"] as Number).toInt() }
