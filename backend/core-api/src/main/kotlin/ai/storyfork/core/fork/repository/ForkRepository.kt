package ai.storyfork.core.fork.repository

import ai.storyfork.core.fork.entity.ForkEntity
import org.springframework.data.jpa.repository.*

interface ForkRepository : JpaRepository<ForkEntity, String> {
    fun findAllByOwnerIdAndSourceWorkId(ownerId: String, sourceWorkId: String): List<ForkEntity>
}
