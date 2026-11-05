package ai.storyfork.content.fork.repository

import ai.storyfork.content.fork.entity.ForkChangeDecisionEntity
import org.springframework.data.jpa.repository.*

interface ForkChangeDecisionRepository : JpaRepository<ForkChangeDecisionEntity, String> {
    fun findAllBySourceChangeIdInOrderByDecidedAtAscIdAsc(sourceChangeIds: Collection<String>): List<ForkChangeDecisionEntity>
}
