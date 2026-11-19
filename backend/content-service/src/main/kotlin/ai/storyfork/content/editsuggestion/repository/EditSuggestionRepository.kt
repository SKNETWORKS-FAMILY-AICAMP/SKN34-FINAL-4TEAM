package ai.storyfork.content.editsuggestion.repository

import ai.storyfork.content.editsuggestion.entity.EditSuggestionEntity
import org.springframework.data.jpa.repository.*

interface EditSuggestionRepository : JpaRepository<EditSuggestionEntity, String> {
    /** 작품과 제안 ID가 모두 맞는 제안 하나다. 다른 작품의 제안이면 없는 것으로 본다. */
    fun findByIdAndWorkId(id: String, workId: String): EditSuggestionEntity?

    /** 내가 올린 제안을 작성 최신순으로 최대 200개 돌려준다. */
    fun findTop200ByProposerIdOrderByCreatedAtDesc(proposerId: String): List<EditSuggestionEntity>

    /** 주어진 작품들의 제안을 작성 최신순으로 최대 200개 돌려준다. */
    fun findTop200ByWorkIdInOrderByCreatedAtDesc(workIds: Collection<String>): List<EditSuggestionEntity>

    /** 작가가 아직 판단하지 않은(`pending`) 제안 수다. 삭제된 작품의 제안은 모든 경로에서 없는 것으로 보므로 세지 않는다(운영 통계, DEC-55). */
    @Query("select count(s) from EditSuggestionEntity s join WorkEntity w on w.id = s.workId where s.status = 'pending' and w.deletedAt is null")
    fun countPending(): Long

    /** [status]인 제안 중 판단 시각이 [from]~[to](양 끝 포함)인 수다(운영 통계, DEC-55). */
    fun countByStatusAndDecidedAtBetween(status: String, from: java.time.Instant, to: java.time.Instant): Long
}
