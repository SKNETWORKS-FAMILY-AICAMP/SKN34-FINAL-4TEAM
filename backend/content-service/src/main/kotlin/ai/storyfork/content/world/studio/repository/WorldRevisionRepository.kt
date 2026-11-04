package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.WorldRevision
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface WorldRevisionRepository : JpaRepository<WorldRevision, UUID> {
    fun findByIdAndWorldId(id: UUID, worldId: UUID): WorldRevision?
    fun findFirstByWorldIdOrderByRevisionNoDesc(worldId: UUID): WorldRevision?
}
