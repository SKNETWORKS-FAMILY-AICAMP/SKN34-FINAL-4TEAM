package ai.storyfork.content.proposal.repository

import ai.storyfork.content.proposal.entity.ProposalEvidenceEntity
import org.springframework.data.jpa.repository.*

interface ProposalEvidenceRepository : JpaRepository<ProposalEvidenceEntity, ProposalEvidenceEntity.Key> {

    fun findAllByProposalId(proposalId: String): List<ProposalEvidenceEntity>
}
