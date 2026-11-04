package ai.storyfork.core.proposal.repository

import ai.storyfork.core.proposal.entity.AiJobEntity
import org.springframework.data.jpa.repository.*

interface AiJobRepository : JpaRepository<AiJobEntity, String> {
    fun findAllByWorkIdOrderByCreatedAt(workId: String): List<AiJobEntity>
}
