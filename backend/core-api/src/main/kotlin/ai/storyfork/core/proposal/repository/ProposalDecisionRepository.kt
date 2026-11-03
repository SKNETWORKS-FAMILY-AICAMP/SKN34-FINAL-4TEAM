package ai.storyfork.core.proposal.repository

import ai.storyfork.core.proposal.entity.ProposalDecisionEntity
import org.springframework.data.jpa.repository.*

interface ProposalDecisionRepository : JpaRepository<ProposalDecisionEntity, String> {
    fun findAllByProposalIdOrderBySequence(proposalId: String): List<ProposalDecisionEntity>
}
