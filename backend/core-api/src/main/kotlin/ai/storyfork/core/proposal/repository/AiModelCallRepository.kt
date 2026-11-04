package ai.storyfork.core.proposal.repository

import ai.storyfork.core.proposal.entity.AiModelCallEntity
import org.springframework.data.jpa.repository.*

interface AiModelCallRepository : JpaRepository<AiModelCallEntity, String> {
    fun findFirstByJobIdOrderBySequence(jobId: String): AiModelCallEntity?
}
