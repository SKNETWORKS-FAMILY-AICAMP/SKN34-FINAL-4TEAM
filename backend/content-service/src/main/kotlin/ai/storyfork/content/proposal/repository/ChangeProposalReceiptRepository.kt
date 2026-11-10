package ai.storyfork.content.proposal.repository

import ai.storyfork.content.proposal.entity.ChangeProposalReceiptEntity
import org.springframework.data.jpa.repository.JpaRepository

interface ChangeProposalReceiptRepository : JpaRepository<ChangeProposalReceiptEntity,String> {
    fun findByWorkIdAndActorIdAndKeyHash(workId: String,actorId: String,keyHash: String): ChangeProposalReceiptEntity?
    fun findByProposalIdAndProposalVersion(proposalId: String,proposalVersion: Int): ChangeProposalReceiptEntity?
}
