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
}
