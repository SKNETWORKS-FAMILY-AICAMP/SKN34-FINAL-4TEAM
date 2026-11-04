package ai.storyfork.content.proposal.repository

import ai.storyfork.content.proposal.entity.ProposalApplicationEntity
import org.springframework.data.jpa.repository.*

interface ProposalApplicationRepository : JpaRepository<ProposalApplicationEntity, String> {
    fun findAllByDecisionIdOrderByAttemptNo(decisionId: String): List<ProposalApplicationEntity>
}
