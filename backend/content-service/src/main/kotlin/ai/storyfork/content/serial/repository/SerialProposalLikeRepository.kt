package ai.storyfork.content.serial.repository

import ai.storyfork.content.serial.entity.SerialProposalLikeEntity
import org.springframework.data.jpa.repository.JpaRepository

interface SerialProposalLikeRepository : JpaRepository<SerialProposalLikeEntity, SerialProposalLikeEntity.Key> {
    fun findAllByProposalIdIn(proposalIds: Collection<String>): List<SerialProposalLikeEntity>
    fun findByProposalIdAndMemberId(proposalId: String, memberId: String): SerialProposalLikeEntity?
}
