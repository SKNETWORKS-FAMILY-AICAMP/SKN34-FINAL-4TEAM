package ai.storyfork.core.world.repository

import ai.storyfork.core.world.entity.WorldRevisionRelationship
import ai.storyfork.core.world.entity.RevisionRelationshipKey
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface WorldRevisionRelationshipRepository : JpaRepository<WorldRevisionRelationship, RevisionRelationshipKey> {
    fun findAllByIdRevisionId(revisionId: UUID): List<WorldRevisionRelationship>
}
