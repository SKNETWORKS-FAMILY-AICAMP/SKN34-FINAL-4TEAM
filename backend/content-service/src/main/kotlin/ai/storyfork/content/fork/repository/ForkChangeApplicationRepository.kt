package ai.storyfork.content.fork.repository

import ai.storyfork.content.fork.entity.ForkChangeApplicationEntity
import org.springframework.data.jpa.repository.*

interface ForkChangeApplicationRepository : JpaRepository<ForkChangeApplicationEntity, String> {
    fun findAllByDecisionIdIn(decisionIds: Collection<String>): List<ForkChangeApplicationEntity>
}
