package ai.storyfork.content.proposal.repository

import ai.storyfork.content.proposal.entity.AiProposalEntity
import org.springframework.data.jpa.repository.*

interface AiProposalRepository : JpaRepository<AiProposalEntity, String> {
    fun findAllByJobIdInOrderByCreatedAt(jobIds: Collection<String>): List<AiProposalEntity>

    /** 생성 시각이 [from]~[to](양 끝 포함)인 AI 제안 수다. 생성에 실패한 요청은 제안 행이 없어 세지 않는다(운영 통계, DEC-55). */
    fun countByCreatedAtBetween(from: java.time.Instant, to: java.time.Instant): Long
}
