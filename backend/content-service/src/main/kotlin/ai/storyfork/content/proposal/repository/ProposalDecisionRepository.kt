package ai.storyfork.content.proposal.repository

import ai.storyfork.content.proposal.entity.ProposalDecisionEntity
import org.springframework.data.jpa.repository.*

interface ProposalDecisionRepository : JpaRepository<ProposalDecisionEntity, String> {
    fun findAllByProposalIdOrderBySequence(proposalId: String): List<ProposalDecisionEntity>
}
