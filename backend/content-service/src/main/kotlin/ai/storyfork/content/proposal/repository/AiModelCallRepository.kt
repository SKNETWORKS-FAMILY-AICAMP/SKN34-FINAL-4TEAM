package ai.storyfork.content.proposal.repository

import ai.storyfork.content.proposal.entity.AiModelCallEntity
import org.springframework.data.jpa.repository.*

interface AiModelCallRepository : JpaRepository<AiModelCallEntity, String> {
    fun findFirstByJobIdOrderBySequence(jobId: String): AiModelCallEntity?
}
