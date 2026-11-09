package ai.storyfork.content.fork.repository

import ai.storyfork.content.fork.entity.ForkEntity
import org.springframework.data.jpa.repository.*

interface ForkRepository : JpaRepository<ForkEntity, String> {
    fun findAllByOwnerIdAndSourceWorkId(ownerId: String, sourceWorkId: String): List<ForkEntity>
    fun findAllBySourceWorkId(sourceWorkId: String): List<ForkEntity>
}
