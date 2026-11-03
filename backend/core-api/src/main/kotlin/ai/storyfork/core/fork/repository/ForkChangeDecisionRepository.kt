package ai.storyfork.core.fork.repository

import ai.storyfork.core.fork.entity.ForkChangeDecisionEntity
import org.springframework.data.jpa.repository.*

interface ForkChangeDecisionRepository : JpaRepository<ForkChangeDecisionEntity, String> {
    fun findAllBySourceChangeIdInOrderByDecidedAtAscIdAsc(sourceChangeIds: Collection<String>): List<ForkChangeDecisionEntity>
}
