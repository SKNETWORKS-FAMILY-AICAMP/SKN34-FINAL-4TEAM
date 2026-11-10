package ai.storyfork.content.proposal.repository

import ai.storyfork.content.proposal.entity.AiRunEventEntity
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository

interface AiRunEventRepository : JpaRepository<AiRunEventEntity,String> {
    fun findAllByRunIdAndSeqGreaterThanOrderBySeqAsc(runId: String,seq: Long,pageable: Pageable): List<AiRunEventEntity>
    fun findFirstByRunIdAndTaskIdAndAttemptAndPhaseOrderByStepDesc(runId: String,taskId: String,attempt: Int,phase: String): AiRunEventEntity?
}
