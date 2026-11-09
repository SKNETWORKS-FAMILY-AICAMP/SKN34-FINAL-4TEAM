package ai.storyfork.content.proposal.repository

import ai.storyfork.content.proposal.entity.AiRunEntity
import org.springframework.data.domain.Pageable
import org.springframework.data.domain.Slice
import org.springframework.data.jpa.repository.JpaRepository

interface AiRunRepository : JpaRepository<AiRunEntity,String> {
    fun findByRequesterIdAndWorkIdAndOperationAndKeyHash(requesterId: String,workId: String,operation: String,keyHash: String): AiRunEntity?
    fun existsByThreadIdAndStatusIn(threadId: String,statuses: Collection<String>): Boolean
    fun findAllByThreadIdOrderByCreatedAtAscIdAsc(threadId: String,pageable: Pageable): Slice<AiRunEntity>
}
