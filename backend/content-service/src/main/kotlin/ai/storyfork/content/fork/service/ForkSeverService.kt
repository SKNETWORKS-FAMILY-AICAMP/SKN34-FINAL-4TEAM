package ai.storyfork.content.fork.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode_version.repository.*
import ai.storyfork.content.fork.repository.*
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.world.repository.*
import ai.storyfork.content.world.service.WorldService
import jakarta.persistence.EntityManager
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * 원작 삭제 전에 Fork가 원작의 행을 더 이상 참조하지 않도록 분리한다.
 * Fork 행과 `origin_kind='fork'`는 유지하므로 재Fork 차단과 "삭제된 원작" 표시는 그대로 동작한다.
 */
@Service
@Transactional(transactionManager="contentTransactionManager")
class ForkSeverService(
    private val access: WorkAccessService,
    private val world: WorldService,
    private val forks: ForkRepository,
    private val references: ForkWorldReferenceRepository,
    private val sourceSettings: ForkSourceSettingRepository,
    private val changes: ForkSourceChangeRepository,
    private val decisions: ForkChangeDecisionRepository,
    private val applications: ForkChangeApplicationRepository,
    private val documents: SettingDocumentRepository,
    private val origins: SettingOriginRepository,
    private val checkpoints: CheckpointRepository,
    private val checkpointEpisodes: CheckpointEpisodeRepository,
    private val checkpointSettings: CheckpointSettingRepository,
    @Qualifier("contentEntityManager") private val em: EntityManager,
) {
    /** 원작에서 만들어진 모든 Fork를 분리한다. */
    fun severAll(sourceWorkId: String) = forks.findAllBySourceWorkId(sourceWorkId).forEach { sever(it.workId) }

    /** 이미 분리된 Fork는 아무것도 바꾸지 않는다. */
    fun sever(forkWorkId: String) {
        val fork=forks.findById(forkWorkId).orElseThrow { ContentFailure(404,"작품을 찾을 수 없어요.") }
        if(fork.sourceDeletedAt!=null) return
        val source=access.get(forkWorkId).source ?: throw ContentFailure(409,"분기 작품이 아니에요.")

        world.detachForSourceDeletion(forkWorkId)
        sourceSettings.deleteAll(sourceSettings.findAllByForkWorkId(forkWorkId))
        origins.deleteAll(origins.findAllById(documents.findAllByWorldId(forkWorkId).map { it.id }))

        val sourceChanges=changes.findAllByForkWorkId(forkWorkId)
        val results=applications.findAllByDecisionIdIn(
            decisions.findAllBySourceChangeIdInOrderByDecidedAtAscIdAsc(sourceChanges.map { it.id }).map { it.id })
        val ownCheckpoints=results.mapNotNull { it.resultCheckpointId }
        results.forEach { it.resultCheckpointId=null }
        sourceChanges.forEach { it.beforeCheckpointId=null; it.afterCheckpointId=null }

        val reference=references.findById(forkWorkId).orElseThrow()
        reference.sourceWorldId=null
        reference.lastFollowedCheckpointId=null
        reference.referenceStatus="independent"
        if(reference.detachedAt==null) reference.detachedAt=Instant.now().truncatedTo(ChronoUnit.MICROS)

        fork.basisEpisode=source.episode
        fork.basisVersion=source.version
        fork.confirmedPolicyHistoryId=null
        fork.sourceWorkId=null
        fork.sourceCheckpointId=null
        fork.sourceDeletedAt=Instant.now().truncatedTo(ChronoUnit.MICROS)
        em.flush()

        // 변경 반영 결과 체크포인트는 Fork 소유지만 원작 회차·설정 버전을 가리키므로 함께 지운다.
        ownCheckpoints.forEach { id ->
            checkpointEpisodes.deleteAll(checkpointEpisodes.findAllByCheckpointId(id))
            checkpointSettings.deleteAll(checkpointSettings.findAllByCheckpointId(id))
            checkpoints.deleteById(id)
        }
        em.flush()
    }
}
