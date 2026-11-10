package ai.storyfork.content.proposal.repository

import ai.storyfork.content.proposal.entity.ChangeDecisionAttemptEntity
import org.springframework.data.jpa.repository.JpaRepository

interface ChangeDecisionAttemptRepository : JpaRepository<ChangeDecisionAttemptEntity,String> {
    fun findByWorkIdAndActorIdAndKeyHash(workId: String,actorId: String,keyHash: String): ChangeDecisionAttemptEntity?
}
