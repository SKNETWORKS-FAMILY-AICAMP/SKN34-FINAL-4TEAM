package ai.storyfork.core.proposal.repository

import ai.storyfork.core.proposal.entity.AiProposalEntity
import org.springframework.data.jpa.repository.*

interface AiProposalRepository : JpaRepository<AiProposalEntity, String> {
    fun findAllByJobIdInOrderByCreatedAt(jobIds: Collection<String>): List<AiProposalEntity>
}
