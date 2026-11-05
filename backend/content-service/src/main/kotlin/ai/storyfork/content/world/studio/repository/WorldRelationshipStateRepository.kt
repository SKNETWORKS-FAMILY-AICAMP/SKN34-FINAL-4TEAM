package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.WorldRelationshipState
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface WorldRelationshipStateRepository:JpaRepository<WorldRelationshipState,UUID>
