package ai.storyfork.core.world.studio.repository

import ai.storyfork.core.world.studio.entity.Relationship
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface RelationshipRepository : JpaRepository<Relationship, UUID> {
}
