package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.WorldRevisionRelationship
import ai.storyfork.content.world.studio.entity.RevisionRelationshipKey
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface WorldRevisionRelationshipRepository : JpaRepository<WorldRevisionRelationship, RevisionRelationshipKey> {
    fun findAllByIdRevisionId(revisionId: UUID): List<WorldRevisionRelationship>
}
