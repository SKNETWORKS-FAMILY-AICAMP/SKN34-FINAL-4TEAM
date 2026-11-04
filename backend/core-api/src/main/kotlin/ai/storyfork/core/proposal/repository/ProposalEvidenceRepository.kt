package ai.storyfork.core.proposal.repository

import ai.storyfork.core.proposal.entity.ProposalEvidenceEntity
import org.springframework.data.jpa.repository.*

interface ProposalEvidenceRepository : JpaRepository<ProposalEvidenceEntity, ProposalEvidenceEntity.Key> {

    fun findAllByProposalId(proposalId: String): List<ProposalEvidenceEntity>
}
