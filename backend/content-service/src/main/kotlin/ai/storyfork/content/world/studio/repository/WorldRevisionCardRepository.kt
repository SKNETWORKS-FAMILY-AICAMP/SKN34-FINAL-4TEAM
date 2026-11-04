package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.WorldRevisionCard
import ai.storyfork.content.world.studio.entity.RevisionCardKey
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface WorldRevisionCardRepository : JpaRepository<WorldRevisionCard, RevisionCardKey> {
    fun findAllByIdRevisionId(revisionId: UUID): List<WorldRevisionCard>
}
