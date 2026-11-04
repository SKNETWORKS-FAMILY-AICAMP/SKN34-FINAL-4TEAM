package ai.storyfork.core.world.repository

import ai.storyfork.core.world.entity.Relationship
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface RelationshipRepository : JpaRepository<Relationship, UUID> {
}
