package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.Relationship
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface RelationshipRepository : JpaRepository<Relationship, UUID> {
}
