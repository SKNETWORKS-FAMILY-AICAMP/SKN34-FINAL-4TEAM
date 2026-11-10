package ai.storyfork.content.proposal.repository

import ai.storyfork.content.proposal.entity.ChangeProposalVersionEntity
import org.springframework.data.jpa.repository.JpaRepository

interface ChangeProposalVersionRepository : JpaRepository<ChangeProposalVersionEntity,String> {
    fun findByRunIdAndKeyHash(runId: String,keyHash: String): ChangeProposalVersionEntity?
    fun findByProposalIdAndProposalVersion(proposalId: String,proposalVersion: Int): ChangeProposalVersionEntity?
    fun findFirstByProposalIdOrderByProposalVersionDesc(proposalId: String): ChangeProposalVersionEntity?
}
