package ai.storyfork.content.proposal.repository

import ai.storyfork.content.proposal.entity.ProposalDecisionEntity
import org.springframework.data.jpa.repository.*

interface ProposalDecisionRepository : JpaRepository<ProposalDecisionEntity, String> {
    fun findAllByProposalIdOrderBySequence(proposalId: String): List<ProposalDecisionEntity>

    /** 결정 시각이 [from]~[to](양 끝 포함)인 제안 결정 수다(운영 통계, DEC-55). */
    fun countByDecidedAtBetween(from: java.time.Instant, to: java.time.Instant): Long

    /** [decision]인 제안 결정 중 결정 시각이 [from]~[to](양 끝 포함)인 수다(운영 통계, DEC-55). */
    fun countByDecisionAndDecidedAtBetween(decision: String, from: java.time.Instant, to: java.time.Instant): Long
}
