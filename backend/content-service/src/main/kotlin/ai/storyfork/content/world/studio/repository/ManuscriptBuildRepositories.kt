package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.*
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.*
import org.springframework.data.repository.query.Param
import java.util.UUID

interface ManuscriptBuildJobRepository:JpaRepository<ManuscriptBuildJob,UUID> {
    @Query("select j.worldId from ManuscriptBuildJob j where j.id=:id")
    fun worldId(@Param("id") id:UUID):UUID?
    fun findFirstByWorldIdAndStatusIn(worldId:UUID,status:List<String>):ManuscriptBuildJob?
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select j from ManuscriptBuildJob j where j.id=:id")
    fun lock(@Param("id") id:UUID):ManuscriptBuildJob?
}

/** world 잠금을 기다리기 전에 versioned job Entity를 읽으면 상태 조회도 optimistic 충돌한다. */
internal fun ManuscriptBuildJobRepository.owned(id:UUID,owner:UUID,worlds:StudioWorldRepository):ManuscriptBuildJob {
    val world=worldId(id) ?: throw ai.storyfork.content.world.domain.WorldNotFound()
    if(worlds.lockAccessible(world,owner)==null) throw ai.storyfork.content.world.domain.WorldNotFound()
    return (lock(id) ?: throw ai.storyfork.content.world.domain.WorldNotFound()).also {
        if(it.ownerSubject!=owner && !ai.storyfork.content.auth.config.operatorReading()) throw ai.storyfork.content.world.domain.WorldNotFound()
    }
}
interface ManuscriptBuildResultRepository:JpaRepository<ManuscriptBuildResult,UUID> {
    fun findByJobIdAndKindAndEpisode(jobId:UUID,kind:String,episode:Int):ManuscriptBuildResult?
    fun findAllByJobIdOrderByEpisode(jobId:UUID):List<ManuscriptBuildResult>
}
interface ManuscriptBuildLoadStepRepository:JpaRepository<ManuscriptBuildLoadStep,UUID> {
    fun findAllByJobIdOrderBySequence(jobId:UUID):List<ManuscriptBuildLoadStep>
}
