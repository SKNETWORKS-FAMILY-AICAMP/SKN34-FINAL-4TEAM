package ai.storyfork.content.proposal.repository

import ai.storyfork.content.proposal.entity.AiJobEntity
import org.springframework.data.jpa.repository.*

interface AiJobRepository : JpaRepository<AiJobEntity, String> {
    fun findAllByWorkIdOrderByCreatedAt(workId: String): List<AiJobEntity>
}
