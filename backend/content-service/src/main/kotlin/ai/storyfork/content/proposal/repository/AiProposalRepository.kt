package ai.storyfork.content.proposal.repository

import ai.storyfork.content.proposal.entity.AiProposalEntity
import org.springframework.data.jpa.repository.*

interface AiProposalRepository : JpaRepository<AiProposalEntity, String> {
    fun findAllByJobIdInOrderByCreatedAt(jobIds: Collection<String>): List<AiProposalEntity>
}
