package ai.storyfork.core.world.repository

import ai.storyfork.core.world.entity.WorldRevisionCard
import ai.storyfork.core.world.entity.RevisionCardKey
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface WorldRevisionCardRepository : JpaRepository<WorldRevisionCard, RevisionCardKey> {
    fun findAllByIdRevisionId(revisionId: UUID): List<WorldRevisionCard>
}
