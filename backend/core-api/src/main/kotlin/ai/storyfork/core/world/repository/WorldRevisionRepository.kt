package ai.storyfork.core.world.repository

import ai.storyfork.core.world.entity.WorldRevision
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface WorldRevisionRepository : JpaRepository<WorldRevision, UUID> {
    fun findByIdAndWorldId(id: UUID, worldId: UUID): WorldRevision?
    fun findFirstByWorldIdOrderByRevisionNoDesc(worldId: UUID): WorldRevision?
}
