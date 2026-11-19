package ai.storyfork.content.proposal.repository

import ai.storyfork.content.proposal.entity.AiProposalEntity
import org.springframework.data.jpa.repository.*
import org.springframework.data.repository.query.Param

interface AiProposalRepository : JpaRepository<AiProposalEntity, String> {
    fun findAllByJobIdInOrderByCreatedAt(jobIds: Collection<String>): List<AiProposalEntity>

    /** 생성 시각이 [from]~[to](양 끝 포함)인 AI 제안 수다. 생성에 실패한 요청은 제안 행이 없어 세지 않는다(운영 통계, DEC-55). */
    fun countByCreatedAtBetween(from: java.time.Instant, to: java.time.Instant): Long

    /**
     * 생성 시각이 [from]~[to](양 끝 포함)인 AI 제안 중 채택(`accept`) 결정이 있는 수다. 같은 집단이라 [countByCreatedAtBetween] 이하이고 결정 시각은 보지 않는다.
     * 결정이 여럿이어도 제안당 한 번만 센다. 의미는 `@Query`가 정한다(이름만으로는 파생 쿼리가 `countByCreatedAtBetween`과 같아진다, 운영 통계 DEC-55).
     */
    @Query("""select count(p) from AiProposalEntity p where p.createdAt between :since and :until
        and exists (select d.id from ProposalDecisionEntity d where d.proposalId = p.id and d.decision = 'accept')""")
    fun countAdoptedByCreatedAtBetween(@Param("since") from: java.time.Instant, @Param("until") to: java.time.Instant): Long
}
