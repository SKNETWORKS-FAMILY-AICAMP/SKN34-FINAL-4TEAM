package ai.storyfork.core.proposal.repository

import ai.storyfork.core.proposal.entity.ProposalApplicationEntity
import org.springframework.data.jpa.repository.*

interface ProposalApplicationRepository : JpaRepository<ProposalApplicationEntity, String> {
    fun findAllByDecisionIdOrderByAttemptNo(decisionId: String): List<ProposalApplicationEntity>
}
